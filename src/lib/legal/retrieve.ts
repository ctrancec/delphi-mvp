/**
 * Getting the right clause in front of the board.
 *
 * Legal retrieval is genuinely semantic in a way organizational memory is not:
 * *"can I use this song over my gameplay clip"* has to surface a
 * synchronisation-licensing clause that never contains the word "song". Plain
 * full-text search fails that question completely.
 *
 * The schema carries an `embedding` column for exactly this, but embeddings
 * cost an API call per chunk to build and another per query to use. So the
 * first cut does the same job for one cheap call: **expand the question into
 * the vocabulary the law actually uses**, then search full-text with those
 * terms. "song over a clip" becomes synchronisation, musical work, derivative
 * work, public performance — and those words are in the statute.
 *
 * When this stops being good enough, the upgrade is a backfill and a rerank
 * rather than a rewrite, which is why the column is already there.
 */

import { Type, type Schema } from '@google/genai';
import { generateStructured } from '@/lib/llm/gemini';
import { ageInDays } from './sources';
import type { Db, Row } from '@/lib/delphi/db';

const MODEL = 'gemini-3.8-flash';

export interface LegalPassage {
    documentTitle: string;
    jurisdiction: string;
    category: string;
    sourceUrl: string;
    section: string | null;
    text: string;
    /** Days since the document was last confirmed. Shown beside every citation. */
    ageDays: number;
    stale: boolean;
}

const EXPANSION_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        terms: {
            type: Type.ARRAY,
            description:
                'Between 6 and 14 terms of art that the governing law or platform policy would actually use. Not synonyms of the question — the vocabulary of the statute.',
            items: { type: Type.STRING },
        },
    },
    required: ['terms'],
};

const EXPANSION_SYSTEM = `You translate a practical question into the vocabulary its governing law uses.

Example: "can I put this track over my gameplay footage" becomes terms like
synchronisation licence, musical work, sound recording, derivative work,
public performance, mechanical right, fair dealing, fair use.

Rules:
- Terms of art only. Everyday paraphrases of the question are useless here.
- Cover the several bodies of law a question can touch at once — copyright,
  contract, privacy, advertising disclosure — rather than guessing one.
- No explanation, no full sentences. Terms.`;

function validateTerms(value: unknown): { terms: string[] } {
    const v = value as { terms?: unknown };
    const terms = Array.isArray(v?.terms)
        ? v.terms.filter((t): t is string => typeof t === 'string' && t.trim().length > 2)
        : [];
    if (terms.length === 0) throw new Error('No expansion terms returned.');
    return { terms: terms.slice(0, 14).map((t) => t.trim()) };
}

/**
 * The question in the law's own words.
 *
 * Failure returns the original question rather than throwing: degraded
 * retrieval is much better than a board round that cannot run.
 */
export async function expandQuery(question: string): Promise<{ terms: string[]; costUsd: number }> {
    try {
        const result = await generateStructured(question, EXPANSION_SCHEMA, validateTerms, {
            system: EXPANSION_SYSTEM,
            model: MODEL,
            temperature: 0.3,
        });
        return { terms: result.data.terms, costUsd: result.costUsd };
    } catch (err) {
        console.warn('[legal] query expansion failed, falling back to raw terms:', (err as Error).message);
        return { terms: question.split(/\s+/).filter((w) => w.length > 4).slice(0, 10), costUsd: 0 };
    }
}

function toPassage(r: Row): LegalPassage {
    const doc = r.document as unknown as Row;
    const retrievedAt = (doc?.retrieved_at as string) ?? new Date().toISOString();
    const age = ageInDays(retrievedAt);

    return {
        documentTitle: (doc?.title as string) ?? 'Unknown document',
        jurisdiction: (doc?.jurisdiction as string) ?? '',
        category: (doc?.category as string) ?? '',
        sourceUrl: (doc?.source_url as string) ?? '',
        section: (r.section as string) ?? null,
        text: r.text as string,
        ageDays: age,
        stale: age > Number(doc?.refresh_days ?? 90),
    };
}

/**
 * Find the passages that bear on a question.
 *
 * Jurisdictions are filtered rather than ranked, because a Canadian answer
 * citing a US statute is not a slightly worse answer — it is a wrong one.
 */
export async function retrieveLegalContext(
    db: Db,
    workspaceId: string,
    question: string,
    opts: { jurisdictions?: string[]; limit?: number } = {}
): Promise<{ passages: LegalPassage[]; terms: string[]; costUsd: number }> {
    const limit = opts.limit ?? 8;

    const { data: docCount } = await db
        .from('delphi_legal_documents')
        .select('id')
        .eq('workspace_id', workspaceId)
        .limit(1);

    // Nothing stored yet. Say so by returning empty — the board's prompt then
    // states plainly that it is working from recall, rather than implying a
    // library it does not have.
    if (!docCount?.length) return { passages: [], terms: [], costUsd: 0 };

    const { terms, costUsd } = await expandQuery(question);

    // `websearch_to_tsquery` ORs terms when they are quoted phrases separated
    // by spaces, which is what we want: any term of art is a hit, and ranking
    // sorts out which passages carry several.
    const query = terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');

    let q = db
        .from('delphi_legal_chunks')
        .select(
            'section, text, document:delphi_legal_documents!inner ( title, jurisdiction, category, source_url, retrieved_at, refresh_days )'
        )
        .eq('workspace_id', workspaceId)
        .textSearch('ts', query, { type: 'websearch', config: 'english' })
        .limit(limit * 3);

    if (opts.jurisdictions?.length) {
        q = q.in('document.jurisdiction', opts.jurisdictions);
    }

    const { data, error } = await q;
    if (error) {
        console.warn('[legal] retrieval failed:', error.message);
        return { passages: [], terms, costUsd };
    }

    const passages = (data ?? []).map(toPassage);

    // Prefer fresh, and prefer a passage that names its section — an unlabelled
    // chunk makes for a citation nobody can follow.
    passages.sort((a, b) => {
        if (a.stale !== b.stale) return a.stale ? 1 : -1;
        const aLabelled = a.section ? 0 : 1;
        const bLabelled = b.section ? 0 : 1;
        if (aLabelled !== bLabelled) return aLabelled - bLabelled;
        return a.ageDays - b.ageDays;
    });

    return { passages: passages.slice(0, limit), terms, costUsd };
}

/**
 * The retrieved passages as prompt context.
 *
 * Age travels with every passage, because a finding resting on a year-old
 * platform policy is a different kind of claim from one resting on a statute,
 * and the board is told to say which it has.
 */
export function formatLegalContext(passages: LegalPassage[]): string | null {
    if (passages.length === 0) return null;

    return [
        'REFERENCE LIBRARY — cite these by document and section. Do not cite anything not listed here.',
        '',
        ...passages.map((p, i) =>
            [
                `[${i + 1}] ${p.documentTitle}${p.section ? ` — ${p.section}` : ''}`,
                `    jurisdiction: ${p.jurisdiction} · ${p.category} · last confirmed ${p.ageDays} day${p.ageDays === 1 ? '' : 's'} ago${p.stale ? ' (STALE — say so if you rely on it)' : ''}`,
                `    ${p.text.replace(/\s+/g, ' ').slice(0, 1500)}`,
            ].join('\n')
        ),
    ].join('\n');
}
