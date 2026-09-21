/**
 * Translating the world into English.
 *
 * Both the original and the translation are kept, always. That is not
 * politeness — it is what lets any claim in a finished brief be checked against
 * what the outlet actually said, which is the whole reason for reading foreign
 * press rather than an English summary of it.
 *
 * **Translation is the one place cost can run away.** A few thousand items a
 * day is real money, unlike the fractions of a cent an agent run costs. So it
 * is lazy and capped: only items that joined a cluster are translated, because
 * an untranslated singleton nobody corroborated is not worth paying for, and
 * never more than a fixed budget per pass.
 */

import { Type, type Schema } from '@google/genai';
import { generateStructured } from '@/lib/llm/gemini';
import type { Db } from '@/lib/delphi/db';

const MODEL = 'gemini-3.8-flash';

/** A hard stop per pass. The cron runs often; the bill should not. */
export const MAX_PER_PASS = 40;

interface Translated {
    translations: { id: string; title: string; summary: string }[];
}

const SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        translations: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    id: { type: Type.STRING, description: 'Echo back the id exactly as given.' },
                    title: { type: Type.STRING, description: 'The headline in English.' },
                    summary: { type: Type.STRING, description: 'The summary in English. Empty string if there was none.' },
                },
                required: ['id', 'title', 'summary'],
            },
        },
    },
    required: ['translations'],
};

const SYSTEM = `You translate news headlines and summaries into English.

Rules:
- Translate, do not summarise or improve. A headline that is vague in the original stays vague.
- Keep proper nouns, place names and numbers exactly as they appear.
- Do not add context the original does not contain, and never add analysis.
- If an item is already in English, return it unchanged.
- Echo each id back exactly.

You are producing a record that will be checked against the source. Accuracy over fluency.`;

function validate(value: unknown): Translated {
    const root = value as { translations?: unknown };
    if (!Array.isArray(root?.translations)) throw new Error('No translations array returned.');

    const translations = root.translations
        .map((raw) => raw as Record<string, unknown>)
        .filter((t) => typeof t.id === 'string' && typeof t.title === 'string')
        .map((t) => ({
            id: t.id as string,
            title: (t.title as string).slice(0, 500),
            summary: typeof t.summary === 'string' ? t.summary.slice(0, 1200) : '',
        }));

    return { translations };
}

export interface TranslateResult {
    translated: number;
    costUsd: number;
    skipped: number;
}

/**
 * Translate untranslated items that made it into a cluster.
 *
 * Batched into one call: forty separate requests would cost forty times the
 * per-request overhead for the same tokens.
 */
export async function translatePending(
    db: Db,
    workspaceId: string,
    limit = MAX_PER_PASS
): Promise<TranslateResult> {
    const { data: pending } = await db
        .from('delphi_news_items')
        .select('id, language, title_original, summary_original')
        .eq('workspace_id', workspaceId)
        .is('title_en', null)
        .not('cluster_id', 'is', null)
        .neq('language', 'en')
        .limit(limit);

    const items = pending ?? [];
    if (items.length === 0) return { translated: 0, costUsd: 0, skipped: 0 };

    const prompt = items
        .map(
            (i) =>
                `id: ${i.id}\nlanguage: ${i.language}\ntitle: ${i.title_original}\nsummary: ${(i.summary_original as string) ?? ''}`
        )
        .join('\n---\n');

    try {
        const result = await generateStructured<Translated>(prompt, SCHEMA, validate, {
            system: SYSTEM,
            model: MODEL,
            temperature: 0.1,
        });

        const byId = new Map(result.data.translations.map((t) => [t.id, t]));
        let translated = 0;

        for (const item of items) {
            const t = byId.get(item.id as string);
            if (!t) continue;
            const { error } = await db
                .from('delphi_news_items')
                .update({
                    title_en: t.title,
                    summary_en: t.summary || null,
                    translated_at: new Date().toISOString(),
                })
                .eq('id', item.id);
            if (!error) translated++;
        }

        return {
            translated,
            costUsd: result.costUsd,
            skipped: items.length - translated,
        };
    } catch (err) {
        // A failed pass must not stop ingestion. The items stay untranslated
        // and are picked up next time.
        console.error('[world] translation failed:', (err as Error).message);
        return { translated: 0, costUsd: 0, skipped: items.length };
    }
}
