/**
 * What Delphi learned from a finished project.
 *
 * Track record answers "who is good at this?". Retrospectives answer the
 * harder one: "what do we now know that we did not before?" — a source that
 * kept failing, a step that was always redundant, a preference the CHO stated
 * in passing. These are written into organizational memory and retrieved into
 * the next staffing decision, which is what makes project #20 better staffed
 * than project #1.
 *
 * Retrieval is Postgres full-text search, not embeddings. Embeddings cost an
 * API call per write *and* per read, which fights the cheap-brain decision, and
 * deterministic recall is far easier to debug. The `embedding` column exists
 * from day one so turning semantic recall on later is a backfill and a rerank,
 * not a rewrite.
 */

import { Type, type Schema } from '@google/genai';
import { generateStructured } from '@/lib/llm/gemini';
import { emitEvent, writeMemory, type Db } from './db';
import type { MemoryKind } from './types';

const DEFAULT_MODEL = 'gemini-3.8-flash';

interface Lesson {
    kind: MemoryKind;
    title: string;
    body: string;
    tags: string[];
    importance: number;
}

const SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        lessons: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    kind: {
                        type: Type.STRING,
                        enum: ['fact', 'preference', 'lesson', 'outcome'],
                        description:
                            'lesson: something to do differently. preference: something the CHO wants. fact: a durable truth about a source or domain. outcome: what this project produced.',
                    },
                    title: { type: Type.STRING, description: 'One short line, searchable.' },
                    body: {
                        type: Type.STRING,
                        description:
                            'Two or three sentences. Specific and actionable — a lesson nobody can act on is not a lesson.',
                    },
                    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                    importance: {
                        type: Type.INTEGER,
                        description: '1 trivial to 5 must never be forgotten.',
                    },
                },
                required: ['kind', 'title', 'body', 'tags', 'importance'],
            },
        },
    },
    required: ['lessons'],
};

const SYSTEM = `You are Delphi, an AI CEO, writing the retrospective on a project your agents just finished.

Write 3 to 5 lessons worth carrying into future work. Be ruthless about what qualifies:

- A lesson must change a future decision. "The team worked well" changes nothing.
- Prefer the specific over the general. "Reuters RSS returned 403 twice; prefer the wire API" beats "some sources are unreliable".
- Record a CHO preference whenever one was stated or strongly implied, because those are the memories most costly to lose.
- Note which agents did well or badly at what, so future staffing can use it.
- If the project failed or halted, say plainly why, in terms that prevent a repeat.

Do not invent detail. You are writing from the record below; if it does not support a lesson, write fewer.`;


const KINDS: ReadonlySet<string> = new Set(['fact', 'preference', 'lesson', 'outcome']);

/**
 * `responseSchema` guarantees syntactically valid JSON, not a usable shape, so
 * everything is checked before it becomes a memory the next hiring decision
 * reads.
 */
function validateLessons(value: unknown): { lessons: Lesson[] } {
    const root = value as { lessons?: unknown };
    if (!Array.isArray(root?.lessons)) {
        throw new Error('Retrospective returned no lessons array.');
    }

    const lessons: Lesson[] = [];
    for (const raw of root.lessons) {
        const l = raw as Partial<Lesson>;
        if (typeof l.title !== 'string' || !l.title.trim()) continue;
        if (typeof l.body !== 'string' || !l.body.trim()) continue;
        if (typeof l.kind !== 'string' || !KINDS.has(l.kind)) continue;

        lessons.push({
            kind: l.kind as MemoryKind,
            title: l.title.trim(),
            body: l.body.trim(),
            tags: Array.isArray(l.tags) ? l.tags.filter((t): t is string => typeof t === 'string') : [],
            importance: typeof l.importance === 'number' ? l.importance : 3,
        });
    }

    return { lessons };
}

/**
 * Run the retrospective for a finished project and store what it produced.
 *
 * Returns the number of memories written. Never throws: a project that ran
 * successfully must not be reported as failed because reflection afterwards
 * did not work.
 */
export async function runRetrospective(
    db: Db,
    workspaceId: string,
    projectId: string
): Promise<number> {
    try {
        const { data: project } = await db
            .from('delphi_projects')
            .select('id, title, brief, status, spent_usd, department_id')
            .eq('id', projectId)
            .maybeSingle();
        if (!project) return 0;

        // Already reflected on — a re-run of the tick must not double-write.
        const { data: existing } = await db
            .from('delphi_memories')
            .select('id')
            .eq('project_id', projectId)
            .limit(1);
        if (existing?.length) return 0;

        const [{ data: tasks }, { data: artifacts }, { data: events }] = await Promise.all([
            db
                .from('delphi_tasks')
                .select('seq, title, status, agent:delphi_agents ( name, title )')
                .eq('project_id', projectId)
                .order('seq'),
            db
                .from('delphi_artifacts')
                .select('title, kind')
                .eq('project_id', projectId),
            db
                .from('delphi_events')
                .select('type, payload')
                .eq('project_id', projectId)
                .order('id', { ascending: true })
                .limit(60),
        ]);

        const record = [
            `PROJECT: ${project.title}`,
            `BRIEF: ${project.brief}`,
            `OUTCOME: ${project.status}, spent $${Number(project.spent_usd ?? 0).toFixed(4)}`,
            '',
            'TASKS:',
            ...(tasks ?? []).map((t) => {
                const agent = t.agent as unknown as { name: string; title: string } | null;
                return `  ${t.seq}. [${t.status}] ${t.title} — ${agent?.name ?? 'unassigned'} (${agent?.title ?? '—'})`;
            }),
            '',
            'PRODUCED:',
            ...(artifacts ?? []).map((a) => `  ${a.kind}: ${a.title}`),
            '',
            'WHAT HAPPENED:',
            ...(events ?? []).map((e) => {
                const p = (e.payload ?? {}) as Record<string, unknown>;
                return `  ${e.type}: ${[p.actor, p.verb, p.object].filter(Boolean).join(' ')}`;
            }),
        ].join('\n');

        const result = await generateStructured<{ lessons: Lesson[] }>(
            record,
            SCHEMA,
            validateLessons,
            { system: SYSTEM, model: DEFAULT_MODEL, temperature: 0.4 }
        );

        const lessons = result.data.lessons;
        let written = 0;

        for (const lesson of lessons) {
            if (!lesson.title?.trim() || !lesson.body?.trim()) continue;
            await writeMemory(db, workspaceId, {
                scope: 'org',
                departmentId: project.department_id ?? null,
                projectId,
                kind: lesson.kind,
                title: lesson.title.trim(),
                body: lesson.body.trim(),
                tags: (lesson.tags ?? []).filter(Boolean).slice(0, 8),
                importance: Math.min(5, Math.max(1, lesson.importance ?? 3)),
            });
            written++;
        }

        if (written > 0) {
            await emitEvent(db, {
                workspaceId,
                projectId,
                type: 'memory_written',
                actor: 'Delphi',
                verb: 'recorded what it learned',
                object: `${written} lesson${written === 1 ? '' : 's'} from ${project.title}`,
                payload: { costUsd: result.costUsd, model: result.model },
            });
        }

        return written;
    } catch (err) {
        console.error('[delphi] retrospective failed:', (err as Error).message);
        return 0;
    }
}
