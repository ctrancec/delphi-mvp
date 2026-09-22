/**
 * The task runtime — where agents actually do the work.
 *
 * Executes ONE task per invocation and returns. Vercel's function timeout caps
 * out long before a multi-agent pipeline finishes, so the pipeline advances one
 * step at a time with all state in Postgres. A cold start resumes cleanly
 * because nothing lives in memory.
 *
 * Four things are enforced here rather than merely requested in prompts:
 *  - the master switch and the budget, checked before any model call
 *  - source locators on factual claims, treated as a validation failure
 *  - outward-facing actions, which create an approval and block the task
 *  - honest cost accounting, recorded whether the task succeeds or fails
 */

import { Type, type Schema } from '@google/genai';
import { generateWithTools, ModelQuotaError, SchemaValidationError } from '@/lib/llm/gemini';
import { clearRevisionNote } from './revision';
import { isMissingColumn } from './db';
import { toolsForChannels } from '@/lib/channels/registry';
import { emitEvent, getSystemState, listChannels, type Db } from './db';
import { effectiveState } from './schedule';
import type { ArtifactKind, ChannelKind, SourceLocator } from './types';

/** How long a `running` task may sit before it is presumed dead. */
const STALE_RUN_MINUTES = 10;

/** Two replacements, then the objective is the problem, not the agent. */
export const MAX_REPLACEMENTS = 2;

// ---------------------------------------------------------------------------
// Agent output contract
// ---------------------------------------------------------------------------

/**
 * A source locator, as a discriminated union.
 *
 * This used to be one flat object with every field optional and only `kind`
 * required, which is a shape that cannot be wrong — and so was. Asked to cite
 * a FRED observation, the model emitted
 * `{"kind":"series","seriesId":"SP500","url":"https://fred.stlouisfed.org/..."}`
 * with no `date`: plausible, well-formed, and rejected by `validLocator`,
 * which needs both `seriesId` and `date` to point at an actual number. The
 * claim then counted as unsourced. The agent *was* citing its work; the schema
 * simply never told it what a citation of that kind has to carry.
 *
 * `anyOf` with per-variant `required` makes that structurally impossible, and
 * Gemini honours it — verified against the live API, which now returns
 * `{"kind":"series","seriesId":"SP500","date":"2026-09-18"}` unprompted.
 */
const LOCATOR_SCHEMA: Schema = {
    anyOf: [
        {
            type: Type.OBJECT,
            title: 'url',
            description: 'A web page. Both fields are needed to check the citation.',
            properties: {
                kind: { type: Type.STRING, enum: ['url'] },
                url: { type: Type.STRING, description: 'The page the claim came from.' },
                quote: { type: Type.STRING, description: 'The exact passage relied on.' },
            },
            required: ['kind', 'url'],
        },
        {
            type: Type.OBJECT,
            title: 'series',
            description:
                'One observation in a data series. The date is not optional — without it this points at a series rather than at a number, and cannot be checked.',
            properties: {
                kind: { type: Type.STRING, enum: ['series'] },
                seriesId: { type: Type.STRING, description: 'e.g. SP500, DGS10.' },
                date: { type: Type.STRING, description: 'The observation date, YYYY-MM-DD.' },
            },
            required: ['kind', 'seriesId', 'date'],
        },
        {
            type: Type.OBJECT,
            title: 'video',
            description: 'A moment in a clip.',
            properties: {
                kind: { type: Type.STRING, enum: ['video'] },
                path: { type: Type.STRING },
                tMs: { type: Type.INTEGER, description: 'Milliseconds into the clip.' },
            },
            required: ['kind', 'path', 'tMs'],
        },
        {
            type: Type.OBJECT,
            title: 'doc',
            description: 'An artifact produced earlier in this pipeline.',
            properties: {
                kind: { type: Type.STRING, enum: ['doc'] },
                artifactId: { type: Type.STRING },
                section: { type: Type.STRING },
            },
            required: ['kind', 'artifactId'],
        },
    ],
};

const TASK_OUTPUT_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        summary: { type: Type.STRING, description: 'One paragraph the CHO could read alone.' },
        contentMd: { type: Type.STRING, description: 'The deliverable itself, in Markdown.' },
        kind: {
            type: Type.STRING,
            enum: ['report', 'doc', 'dataset', 'social_draft', 'brief', 'other'],
        },
        steps: {
            type: Type.ARRAY,
            description: 'What you did, one line per step, in order.',
            items: {
                type: Type.OBJECT,
                properties: {
                    step: { type: Type.STRING },
                    locator: LOCATOR_SCHEMA,
                },
                required: ['step'],
            },
        },
        claims: {
            type: Type.ARRAY,
            description:
                'Every factual assertion in your deliverable, each with the sources it came from. A claim with no source will be rejected.',
            items: {
                type: Type.OBJECT,
                properties: {
                    claim: { type: Type.STRING },
                    // An array, and required, for two reasons. A comparison is
                    // the ordinary shape of analysis — "4.94% on the 17th,
                    // having touched 5.01% on the 16th" rests on two
                    // observations, and a single field had nowhere to put the
                    // second, so agents attached neither. And an optional field
                    // is one the model may simply omit.
                    locators: {
                        type: Type.ARRAY,
                        description:
                            'Every source this claim rests on: one for a simple fact, several when it compares or combines observations. Copy each exactly as the tool returned it.',
                        items: LOCATOR_SCHEMA,
                    },
                },
                required: ['claim', 'locators'],
            },
        },
        proposedAction: {
            type: Type.OBJECT,
            description:
                'Set ONLY if this work requires an action that reaches the outside world or cannot be undone. It will be held for CHO approval, never executed directly.',
            properties: {
                type: {
                    type: Type.STRING,
                    enum: [
                        'social_post', 'publish', 'send_email', 'send_message',
                        'spend', 'file_write', 'file_delete', 'external_api', 'other',
                    ],
                },
                summary: { type: Type.STRING },
                risk: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
                payload: { type: Type.STRING, description: 'The exact payload, as JSON text.' },
            },
            required: ['type', 'summary'],
        },
        handoffNote: {
            type: Type.STRING,
            description:
                'What the next agent needs to know: what you completed and verified, what you deliberately left, and which sources you already consulted.',
        },
    },
    required: ['summary', 'contentMd', 'kind', 'steps', 'claims', 'handoffNote'],
};

export interface AgentOutput {
    summary: string;
    contentMd: string;
    kind: ArtifactKind;
    steps: { step: string; locator?: SourceLocator }[];
    claims: { claim: string; locators: SourceLocator[] }[];
    proposedAction?: { type: string; summary: string; risk?: string; payload?: string };
    handoffNote: string;
}

/** A locator is only useful if it actually carries the fields its kind needs. */
function validLocator(raw: unknown): SourceLocator | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const l = raw as Record<string, unknown>;

    switch (l.kind) {
        case 'url':
            return typeof l.url === 'string' && l.url.trim()
                ? { kind: 'url', url: l.url, quote: typeof l.quote === 'string' ? l.quote : undefined }
                : undefined;
        case 'video':
            return typeof l.path === 'string' && Number.isFinite(Number(l.tMs))
                ? { kind: 'video', path: l.path, tMs: Number(l.tMs) }
                : undefined;
        case 'series':
            return typeof l.seriesId === 'string' && typeof l.date === 'string'
                ? { kind: 'series', seriesId: l.seriesId, date: l.date }
                : undefined;
        case 'doc':
            return typeof l.artifactId === 'string'
                ? {
                      kind: 'doc',
                      artifactId: l.artifactId,
                      section: typeof l.section === 'string' ? l.section : undefined,
                  }
                : undefined;
        default:
            return undefined;
    }
}

/** Canonical form of a locator, for comparing a citation to a tool result. */
function locatorKey(l: SourceLocator): string {
    switch (l.kind) {
        case 'url':
            // Ignore trailing slashes and query noise; the document is the thing.
            try {
                const u = new URL(l.url);
                return `url:${u.origin}${u.pathname.replace(/\/$/, '')}`;
            } catch {
                return `url:${l.url}`;
            }
        case 'series':
            return `series:${l.seriesId}:${l.date}`;
        case 'video':
            return `video:${l.path}`;
        case 'doc':
            return `doc:${l.artifactId}`;
    }
}

/** How many of each list to name before the prompt stops being readable. */
const MAX_LISTED = 12;
const MAX_SOURCES = 25;
const MAX_DATES = 60;

/**
 * The catalogue, grouped by source rather than listed flat.
 *
 * A single FRED query returns every observation in the window, and each one is
 * its own locator — so a flat list is forty consecutive dates of one series
 * and nothing else. That is exactly what happened the first time this ran: the
 * analyst was shown forty days of DGS10, never saw that SP500, CPIAUCSL or
 * FEDFUNDS were also available, and could not cite the claims it most wanted
 * to make. It had the evidence. We were hiding it.
 *
 * Grouping puts every distinct source in front of the agent, and collapses a
 * series' dates into one line underneath it.
 */
function catalogueLines(allowed: Map<string, SourceLocator>): string[] {
    const series = new Map<string, string[]>();
    const other: string[] = [];

    for (const loc of allowed.values()) {
        if (loc.kind === 'series') {
            const dates = series.get(loc.seriesId) ?? [];
            dates.push(loc.date);
            series.set(loc.seriesId, dates);
        } else {
            const line = JSON.stringify(loc);
            if (!other.includes(line)) other.push(line);
        }
    }

    const lines: string[] = [];

    for (const [seriesId, dates] of [...series].slice(0, MAX_SOURCES)) {
        const sorted = [...new Set(dates)].sort();
        const shown = sorted.slice(-MAX_DATES);
        lines.push(`  {"kind":"series","seriesId":"${seriesId}","date":"<one of these>"}`);
        lines.push(
            `      ${shown.join(', ')}` +
                (sorted.length > shown.length ? ` (+${sorted.length - shown.length} earlier)` : '')
        );
    }

    for (const line of other.slice(0, MAX_SOURCES)) lines.push(`  ${line}`);
    if (other.length > MAX_SOURCES) lines.push(`  ...and ${other.length - MAX_SOURCES} more.`);

    return lines;
}

/**
 * The agent cited, and the citation could not be used.
 *
 * Quotes back what it actually sent, because the gap is usually one missing
 * field and seeing its own output next to a working example closes it faster
 * than any amount of instruction.
 */
function malformedMessage(
    bad: { claim: string; raw: unknown[] }[],
    allowed?: Map<string, SourceLocator>
): string {
    const lines = [
        `${bad.length} claim(s) carry a locator that cannot be used. A locator has to identify`,
        'one specific thing: a `series` needs both `seriesId` and `date`, a `url` needs `url`,',
        'a `video` needs `path` and `tMs`, a `doc` needs `artifactId`.',
        '',
        'What you sent:',
    ];
    for (const b of bad.slice(0, MAX_LISTED)) {
        lines.push(`  - "${b.claim.slice(0, 120)}"`);
        for (const r of b.raw.slice(0, 3)) lines.push(`      ${JSON.stringify(r).slice(0, 200)}`);
    }
    if (bad.length > MAX_LISTED) lines.push(`  ...and ${bad.length - MAX_LISTED} more.`);

    const catalogue = allowed ? catalogueLines(allowed) : [];
    if (catalogue.length > 0) {
        lines.push(
            '',
            'Copy from what your own tool calls returned, exactly as written here:',
            '',
            ...catalogue
        );
    }
    return lines.join('\n');
}

/**
 * The rejection an agent can actually act on: which claims are unsourced, and
 * every source its own tools returned this run, in the shape the schema wants.
 */
function unsourcedMessage(unsourced: string[], allowed?: Map<string, SourceLocator>): string {
    const lines = [
        `${unsourced.length} claim(s) have no source locator. Every factual claim needs one.`,
        '',
        'Unsourced claims:',
        ...unsourced.slice(0, MAX_LISTED).map((c) => `  - "${c.slice(0, 160)}"`),
    ];
    if (unsourced.length > MAX_LISTED) {
        lines.push(`  ...and ${unsourced.length - MAX_LISTED} more. Every one of them needs a locator.`);
    }

    const catalogue = allowed ? catalogueLines(allowed) : [];
    if (catalogue.length > 0) {
        lines.push(
            '',
            'These are the sources your own tool calls returned this run. Attach the ones',
            'each claim actually came from, copied exactly. A claim that compares two',
            'observations needs both, in `locators` — that is what the array is for. Do not',
            'invent sources, and do not drop a claim you cannot source: remove it instead.',
            '',
            ...catalogue
        );
    } else {
        lines.push(
            '',
            'No tool returned a source this run, so there is nothing you may cite.',
            'State only what the upstream material supports, and drop the rest.'
        );
    }

    return lines.join('\n');
}

export function validateAgentOutput(
    value: unknown,
    allowed?: Map<string, SourceLocator>
): AgentOutput {
    const o = value as Record<string, unknown>;
    if (!o || typeof o !== 'object') throw new Error('output must be an object');

    const contentMd = String(o.contentMd ?? '').trim();
    if (!contentMd) throw new Error('contentMd is empty — the task produced no deliverable');

    const rawClaims = Array.isArray(o.claims) ? o.claims : [];
    const claims: AgentOutput['claims'] = [];
    const unsourced: string[] = [];
    const malformed: { claim: string; raw: unknown[] }[] = [];
    const fabricated: string[] = [];

    for (const c of rawClaims) {
        const r = c as Record<string, unknown>;
        const claim = String(r.claim ?? '').trim();
        if (!claim) continue;

        // `locators` is what the schema asks for now; the singular `locator`
        // is still read so runs recorded before that change still parse.
        const raw = [
            ...(Array.isArray(r.locators) ? r.locators : []),
            ...(r.locator ? [r.locator] : []),
        ];
        const locators: SourceLocator[] = [];
        const seen = new Set<string>();
        let dropped = 0;
        for (const candidate of raw) {
            const locator = validLocator(candidate);
            if (!locator) {
                dropped++;
                continue;
            }
            const key = locatorKey(locator);
            if (seen.has(key)) continue;
            seen.add(key);
            locators.push(locator);
        }

        if (locators.length === 0) {
            // Citing badly and not citing at all are different mistakes and
            // need different corrections, but both used to land here as
            // "unsourced". That is how a schema which let a `series` locator
            // omit its `date` survived four production runs: the agent was
            // citing, the citations were being dropped as unusable, and the
            // report said only that the claims had no source.
            if (dropped > 0) malformed.push({ claim, raw });
            else unsourced.push(claim);
            continue;
        }

        // The anti-fabrication check. An agent may only cite a source a channel
        // actually returned this run. Checking a URL's *shape* is not enough —
        // a model with no web access will happily emit a well-formed URL that
        // points nowhere. Checking it against the tool results makes inventing
        // a citation structurally impossible rather than merely detectable.
        // `doc` locators are exempt: those reference upstream artifacts in this
        // pipeline, which no channel returns.
        //
        // Every locator on a claim has to hold up. One real source does not
        // license the invented one standing next to it.
        const invented =
            allowed &&
            locators.some((l) => l.kind !== 'doc' && !allowed.has(locatorKey(l)));
        if (invented) {
            fabricated.push(claim);
            continue;
        }

        claims.push({ claim, locators });
    }

    // The accuracy guarantee is only real if this is enforced. An agent that
    // asserts facts with no traceable source has produced unverifiable work,
    // and the repair round exists precisely to give it a chance to fix that.
    //
    // Which is why this says more than "you forgot". The first time it fired in
    // production, the analyst had done everything right — queried FRED for
    // SP500, DGS10, T10Y2Y, FEDFUNDS, ran two searches — and then wrote
    // twenty-three claims off that evidence without attaching it. The repair
    // round was told only that three of them lacked a locator, so it had no
    // more to work with than the first attempt did, and failed the same way.
    //
    // The runtime knows exactly what the tools returned. Handing that catalogue
    // back turns the repair from "try harder" into a matching exercise.
    if (malformed.length > 0) {
        throw new Error(malformedMessage(malformed, allowed));
    }

    if (unsourced.length > 0) {
        throw new Error(unsourcedMessage(unsourced, allowed));
    }

    if (fabricated.length > 0) {
        throw new Error(
            `${fabricated.length} claim(s) cite a source no tool returned — cite only what your channels gave you: ` +
                fabricated.slice(0, 3).map((c) => `"${c.slice(0, 80)}"`).join(', ')
        );
    }

    const steps = (Array.isArray(o.steps) ? o.steps : []).map((s) => {
        const r = s as Record<string, unknown>;
        return { step: String(r.step ?? '').trim(), locator: validLocator(r.locator) };
    }).filter((s) => s.step);

    const pa = o.proposedAction as Record<string, unknown> | undefined;

    return {
        summary: String(o.summary ?? '').trim(),
        contentMd,
        kind: (['report', 'doc', 'dataset', 'social_draft', 'brief', 'other'].includes(String(o.kind))
            ? String(o.kind)
            : 'report') as ArtifactKind,
        steps,
        claims,
        proposedAction:
            pa && typeof pa === 'object' && pa.type
                ? {
                      type: String(pa.type),
                      summary: String(pa.summary ?? ''),
                      risk: pa.risk ? String(pa.risk) : 'medium',
                      payload: pa.payload ? String(pa.payload) : undefined,
                  }
                : undefined,
        handoffNote: String(o.handoffNote ?? '').trim(),
    };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export type StepOutcome =
    | { status: 'done'; taskId: string; costUsd: number; artifactId: string | null }
    | { status: 'awaiting_approval'; taskId: string; approvalId: string }
    | { status: 'failed'; taskId: string; error: string }
    | {
          status: 'halted';
          reason:
              | 'budget'
              | 'system_paused'
              | 'system_stopped'
              | 'upstream_failed'
              | 'model_quota'
              | 'out_of_hours';
      }
    | { status: 'idle'; reason: 'no_pending_tasks' };

/**
 * Fail out tasks whose run died mid-flight.
 *
 * In-memory state does not survive a cold start, so without this a crashed task
 * spins forever in the UI and blocks its pipeline.
 */
export async function reconcileStaleRuns(db: Db, workspaceId: string): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();

    const { data: stale } = await db
        .from('delphi_task_runs')
        .select('id, task_id')
        .eq('workspace_id', workspaceId)
        .eq('status', 'running')
        .lt('started_at', cutoff);

    if (!stale?.length) return 0;

    for (const run of stale) {
        await db
            .from('delphi_task_runs')
            .update({
                status: 'failed',
                error: `Run exceeded ${STALE_RUN_MINUTES} minutes without completing; presumed dead.`,
                finished_at: new Date().toISOString(),
            })
            .eq('id', run.id);
        await db.from('delphi_tasks').update({ status: 'failed' }).eq('id', run.task_id);
    }
    return stale.length;
}

/** What the previous step handed over. */
export interface Upstream {
    title: string;
    contentMd: string;
    handoffNote?: string;
}

export interface UpstreamResolution {
    upstream: Upstream | null;
    /** Set when the chain is broken and the pipeline must stop. */
    halt?: string;
}

/**
 * What the previous step left for this one — or why there is nothing.
 *
 * Extracted from the runner so it can be asserted directly, because the way
 * this fails is silent. A broken chain does not throw; it produces a confident
 * report written from nothing, which reads exactly like a real one.
 *
 * The bar is a deliverable, not a status. A task the CHO rejected at the
 * approval gate is `skipped` but may still have produced perfectly good work,
 * and the rest of the pipeline can run on it. The inverse is the bug this was
 * written to close: the guard used to halt only when the upstream task had not
 * finished, so a step that finished and whose output was later deleted matched
 * neither branch — no artifact, no halt — and the next agent was told it was
 * first in the pipeline.
 */
export async function resolveUpstream(db: Db, dependsOn: string): Promise<UpstreamResolution> {
    // An output in the trash has been withdrawn, so it stops feeding the
    // pipeline. This is the same query that picks the newest version, so
    // trashing a v2 falls back to v1 rather than to nothing.
    const live = () =>
        db
            .from('delphi_artifacts')
            .select('title, content_md, data')
            .eq('task_id', dependsOn)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

    const [first, { data: prevTask }] = await Promise.all([
        live(),
        db.from('delphi_tasks').select('status, title, seq').eq('id', dependsOn).maybeSingle(),
    ]);

    let prev = first.data;

    if (first.error && isMissingColumn(first.error)) {
        // Migration 0006 has not been applied. Nothing can be in the trash, so
        // the filter is meaningless — but left unhandled it would halt a
        // pipeline that is working perfectly well.
        const { data } = await db
            .from('delphi_artifacts')
            .select('title, content_md, data')
            .eq('task_id', dependsOn)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        prev = data;
    }

    if (prev) {
        return {
            upstream: {
                title: prev.title,
                contentMd: prev.content_md ?? '',
                handoffNote: (prev.data as Record<string, unknown>)?.handoffNote as string | undefined,
            },
        };
    }

    // Nothing to hand over. The two causes need different answers, so they are
    // named apart: one is a pipeline that failed, the other is a deliberate
    // deletion that has left a hole behind it.
    return {
        upstream: null,
        halt:
            prevTask?.status === 'done'
                ? `Step ${prevTask.seq} (${prevTask.title}) finished, but its deliverable is gone — deleted, or never recorded. There is nothing to work from.`
                : `Step ${prevTask?.seq ?? '?'} (${prevTask?.title ?? 'upstream'}) is ${prevTask?.status ?? 'missing'} and produced nothing to work from.`,
    };
}

export function buildPrompt(opts: {
    objective: string;
    projectBrief: string;
    upstream: Upstream | null;
    handoffDossier: string | null;
    /** What the CHO refused, in their own words. Outranks everything else. */
    choNote?: string | null;
    revision?: number;
    toolNames?: string[];
}): string {
    const parts: string[] = [];

    // First, and unmissable. A person has looked at the last attempt and said
    // it was not good enough — that outranks the brief, the upstream note and
    // anything this agent thought it was doing, because it is the only part of
    // the prompt that comes from the person the work is for.
    if (opts.choNote) {
        parts.push(
            '--- THE CHO SENT YOUR LAST ATTEMPT BACK ---',
            `This is attempt ${(opts.revision ?? 1) + 1}. They said:`,
            '',
            opts.choNote,
            '',
            'Address that specifically. Producing the same work again with different',
            'wording is not a revision. If their request cannot be met from what your',
            'sources actually support, say so plainly in the deliverable rather than',
            'padding around it.',
            ''
        );
    }

    parts.push('PROJECT BRIEF (context, not your task):', opts.projectBrief, '');

    if (opts.upstream) {
        parts.push(
            '--- INPUT FROM THE PREVIOUS AGENT ---',
            `Title: ${opts.upstream.title}`,
            opts.upstream.contentMd,
            ''
        );
        if (opts.upstream.handoffNote) {
            parts.push('They left you this note:', opts.upstream.handoffNote, '');
        }
    } else {
        parts.push('You are first in the pipeline. There is no upstream input.', '');
    }

    // Only present when this task was taken over from a replaced agent.
    if (opts.handoffDossier) {
        parts.push(
            '--- YOU ARE TAKING OVER THIS TASK ---',
            opts.handoffDossier,
            'Continue from where your predecessor stopped. Do not redo work already verified.',
            ''
        );
    }

    if (opts.toolNames?.length) {
        parts.push(
            '--- YOUR CHANNELS ---',
            `You can call: ${opts.toolNames.join(', ')}. Use them before asserting anything current.`,
            'Citations are checked against what these tools actually return. A source you did not',
            'receive from a tool will be rejected, so do not reconstruct URLs from memory.',
            ''
        );
    } else {
        parts.push(
            '--- NO CHANNELS ---',
            'You have no external tools this run. Work only from the input above, and do not',
            'assert anything you cannot attribute to it.',
            ''
        );
    }

    parts.push(
        '--- YOUR TASK ---',
        opts.objective,
        '',
        'Deliver it. Every factual claim needs a source locator; a claim you cannot source, you do not make.'
    );

    return parts.join('\n');
}

/**
 * Execute the next pending task in a project.
 *
 * Returns after exactly one task so the caller (a cron tick, or a self-invoke)
 * can re-enter. Never throws for ordinary failures — those are recorded on the
 * run and surfaced in the return value, because a thrown error loses the cost
 * that was already spent.
 */
export async function runNextTask(
    db: Db,
    workspaceId: string,
    projectId: string
): Promise<StepOutcome> {
    // 1. The master switch and the working hours, together, win over
    //    everything. Reported apart because "switched off" and "it is 3am" are
    //    different answers to "why is nothing happening", and only one of them
    //    is something to go and fix.
    const now = effectiveState(await getSystemState(db, workspaceId));
    if (now.mode !== 'running') {
        return {
            status: 'halted',
            reason:
                now.reason === 'out_of_hours'
                    ? 'out_of_hours'
                    : now.mode === 'paused'
                      ? 'system_paused'
                      : 'system_stopped',
        };
    }

    const { data: project } = await db
        .from('delphi_projects')
        .select('*')
        .eq('id', projectId)
        .single();
    if (!project) return { status: 'failed', taskId: '', error: 'Project not found.' };

    // 2. Budget, before any spending happens.
    if (Number(project.spent_usd) >= Number(project.budget_usd)) {
        await db.from('delphi_projects').update({ status: 'halted_budget' }).eq('id', projectId);
        await emitEvent(db, {
            workspaceId,
            projectId,
            type: 'budget_halted',
            actor: 'Delphi',
            verb: 'halted the project on budget',
            object: `$${Number(project.spent_usd).toFixed(4)} of $${Number(project.budget_usd).toFixed(2)}`,
        });
        return { status: 'halted', reason: 'budget' };
    }

    const { data: task } = await db
        .from('delphi_tasks')
        .select('*, agent:delphi_agents(*)')
        .eq('project_id', projectId)
        .eq('status', 'pending')
        .order('seq')
        .limit(1)
        .maybeSingle();

    if (!task) {
        const { data: remaining } = await db
            .from('delphi_tasks')
            .select('id')
            .eq('project_id', projectId)
            .in('status', ['running', 'awaiting_approval']);

        if (!remaining?.length) {
            await db
                .from('delphi_projects')
                .update({ status: 'done', finished_at: new Date().toISOString() })
                .eq('id', projectId);
            await emitEvent(db, {
                workspaceId,
                projectId,
                type: 'project_done',
                actor: 'Delphi',
                verb: 'finished the project',
                object: project.title,
            });
        }
        return { status: 'idle', reason: 'no_pending_tasks' };
    }

    const agent = task.agent as unknown as {
        id: string; name: string; title: string; system_prompt: string; model: string;
    };

    // A task Delphi escalated runs on the stronger model, whoever holds it.
    // Set per task rather than on the agent, so an agent that struggled with
    // one objective does not become permanently dearer everywhere else.
    const model = (task.model_override as string | null) || agent.model;

    // 3. The upstream artifact — this is the handoff.
    //
    // A missing one is not "no input", it is a broken chain. When the two
    // researchers ahead of it failed, the staff writer was handed nothing and
    // told it was first in the pipeline, so it correctly refused to invent a
    // brief and shipped a polished statement that it had no data. That is the
    // anti-fabrication rule working and the sequencing failing: it should
    // never have been asked. So a broken chain stops the project here rather
    // than buying a model call to produce confident emptiness.
    let upstream: Upstream | null = null;
    if (task.depends_on) {
        const resolved = await resolveUpstream(db, task.depends_on as string);

        if (resolved.halt) {
            await db
                .from('delphi_projects')
                .update({
                    status: 'failed',
                    error: resolved.halt,
                    finished_at: new Date().toISOString(),
                })
                .eq('id', projectId);

            await emitEvent(db, {
                workspaceId,
                projectId,
                taskId: task.id,
                type: 'project_failed',
                actor: 'Delphi',
                verb: 'stopped the pipeline before',
                object: `${agent.name} — ${task.title}`,
                payload: { reason: resolved.halt },
            });

            return { status: 'halted', reason: 'upstream_failed' };
        }

        upstream = resolved.upstream;
    }

    const { data: dossier } = await db
        .from('delphi_handoffs')
        .select('reason, completed_summary, remaining_work, sources_consulted')
        .eq('task_id', task.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    const attempt = ((await db
        .from('delphi_task_runs')
        .select('attempt')
        .eq('task_id', task.id)
        .order('attempt', { ascending: false })
        .limit(1)
        .maybeSingle()).data?.attempt ?? 0) + 1;

    await db.from('delphi_tasks').update({ status: 'running' }).eq('id', task.id);
    const { data: run } = await db
        .from('delphi_task_runs')
        .insert({
            workspace_id: workspaceId,
            task_id: task.id,
            attempt,
            status: 'running',
            model,
        })
        .select('id')
        .single();

    await emitEvent(db, {
        workspaceId,
        projectId,
        taskId: task.id,
        type: 'task_started',
        actor: agent.name,
        verb: 'started',
        object: task.title,
    });

    const startedAt = Date.now();

    try {
        // The agent's tool surface is exactly the channels it was hired with.
        const allChannels = await listChannels(db, workspaceId, true);
        const agentChannelIds: string[] = (task.agent as unknown as { channel_ids?: string[] })
            .channel_ids ?? [];
        const kinds = allChannels
            .filter((c) => agentChannelIds.includes(c.id))
            .map((c) => c.kind as ChannelKind);
        const tools = toolsForChannels(kinds);

        // Every locator a channel hands back this run, keyed for comparison and
        // kept whole so it can be handed back. Citations are checked against
        // this, so an agent cannot invent a source — and when one forgets to
        // cite at all, this is the catalogue the repair round shows it.
        const allowedLocators = new Map<string, SourceLocator>();

        const result = await generateWithTools<AgentOutput>(
            buildPrompt({
                objective: task.objective,
                projectBrief: project.brief,
                upstream,
                choNote: (task.cho_note as string | null) ?? null,
                revision: Number(task.revision_count ?? 0),
                handoffDossier: dossier
                    ? [
                          `Why your predecessor was replaced: ${dossier.reason}`,
                          `Completed and verified: ${dossier.completed_summary}`,
                          `Remaining: ${dossier.remaining_work}`,
                          `Already consulted: ${JSON.stringify(dossier.sources_consulted)}`,
                      ].join('\n')
                    : null,
                toolNames: tools.map((t) => t.declaration.name ?? ''),
            }),
            tools.map((t) => t.declaration),
            async (name, args) => {
                const tool = tools.find((t) => t.declaration.name === name);
                if (!tool) throw new Error(`No such tool: ${name}`);

                const out = await tool.execute(args);
                for (const loc of out.locators) allowedLocators.set(locatorKey(loc), loc);

                await emitEvent(db, {
                    workspaceId,
                    projectId,
                    taskId: task.id,
                    type: 'task_started',
                    actor: agent.name,
                    verb: `queried ${name}`,
                    object: String(args.query ?? args.seriesId ?? '').slice(0, 80),
                });

                return { content: out.content, searchRequests: out.searchRequests };
            },
            TASK_OUTPUT_SCHEMA,
            (value) => validateAgentOutput(value, tools.length > 0 ? allowedLocators : undefined),
            { system: agent.system_prompt, model, temperature: 0.4 }
        );

        const out = result.data;
        const durationMs = Date.now() - startedAt;

        await db
            .from('delphi_task_runs')
            .update({
                status: 'done',
                prompt_tokens: result.usage.promptTokens,
                completion_tokens: result.usage.completionTokens,
                cached_tokens: result.usage.cachedTokens ?? 0,
                cost_usd: result.costUsd,
                model: result.model,
                output: out as unknown as Record<string, unknown>,
                finished_at: new Date().toISOString(),
            })
            .eq('id', run!.id);

        // Spend is tracked on the project so the budget check above is cheap.
        await db
            .from('delphi_projects')
            .update({ spent_usd: Number(project.spent_usd) + result.costUsd })
            .eq('id', projectId);

        // A redo writes a new artifact and marks the one it replaces
        // superseded, rather than overwriting it. Being able to read the new
        // version against the one that was turned down is what makes the
        // feedback loop legible instead of a second opinion simply appearing.
        //
        // Counted from what exists rather than from the task's revision count,
        // because a task gets redone for more reasons than the CHO refusing
        // it: a step upstream being replaced invalidates this one too, and
        // that redo deserves a version number just as much.
        const { data: earlier } = await db
            .from('delphi_artifacts')
            .select('id')
            .eq('task_id', task.id)
            .order('created_at', { ascending: false });

        const previous = (earlier ?? []) as { id: string }[];
        const revision = previous.length + 1;
        const supersedes = previous[0]?.id ?? null;

        const base = {
            workspace_id: workspaceId,
            project_id: projectId,
            task_id: task.id,
            kind: out.kind,
            title: task.title,
            content_md: out.contentMd,
            data: {
                summary: out.summary,
                steps: out.steps,
                claims: out.claims,
                handoffNote: out.handoffNote,
            },
        };

        // Written with the revision columns when the database has them, and
        // without when it does not. A deploy and a migration do not land at the
        // same instant, and the window between them must not be one where every
        // agent's work is lost for want of a column.
        let artifact: { id: string } | null = null;
        const withRevision = await db
            .from('delphi_artifacts')
            .insert({ ...base, revision, supersedes })
            .select('id')
            .single();

        if (withRevision.error && isMissingColumn(withRevision.error)) {
            console.warn('[delphi] artifact revision columns not present yet; run migration 0004.');
            const plain = await db.from('delphi_artifacts').insert(base).select('id').single();
            artifact = (plain.data as { id: string } | null) ?? null;
        } else {
            artifact = (withRevision.data as { id: string } | null) ?? null;
        }

        if (supersedes) {
            // Whatever the CHO had said about it, it has been replaced — and
            // `reviewed_at` and the note stay on the row, so what they said is
            // not lost by recording that it no longer stands.
            await db
                .from('delphi_artifacts')
                .update({ review_status: 'superseded' })
                .eq('id', supersedes);
        }

        // The note has been answered. Leaving it set would hand the same
        // complaint to whoever runs this task next, about work already redone.
        if (task.cho_note) await clearRevisionNote(db, task.id as string);

        // The activity log: one line per step, each carrying its source.
        for (const s of out.steps) {
            await emitEvent(db, {
                workspaceId,
                projectId,
                taskId: task.id,
                type: 'task_done',
                actor: agent.name,
                verb: s.step,
                locator: s.locator,
            });
        }

        await emitEvent(db, {
            workspaceId,
            projectId,
            taskId: task.id,
            type: 'artifact_created',
            actor: agent.name,
            verb: `produced ${out.kind}`,
            object: task.title,
            durationMs,
            payload: { costUsd: result.costUsd, claims: out.claims.length },
        });

        // 4. Outward-facing work stops here and waits for the CHO.
        if (out.proposedAction) {
            const { data: approval } = await db
                .from('delphi_approvals')
                .insert({
                    workspace_id: workspaceId,
                    project_id: projectId,
                    task_id: task.id,
                    action_type: out.proposedAction.type,
                    summary: out.proposedAction.summary,
                    risk: out.proposedAction.risk ?? 'medium',
                    payload: { raw: out.proposedAction.payload ?? null },
                    status: 'pending',
                })
                .select('id')
                .single();

            await db.from('delphi_tasks').update({ status: 'awaiting_approval' }).eq('id', task.id);
            await emitEvent(db, {
                workspaceId,
                projectId,
                taskId: task.id,
                type: 'approval_requested',
                actor: agent.name,
                verb: 'needs your approval to',
                object: out.proposedAction.summary,
            });

            return { status: 'awaiting_approval', taskId: task.id, approvalId: approval!.id };
        }

        await db.from('delphi_tasks').update({ status: 'done' }).eq('id', task.id);

        const { data: next } = await db
            .from('delphi_tasks')
            .select('id, agent:delphi_agents(name)')
            .eq('depends_on', task.id)
            .maybeSingle();

        if (next) {
            await emitEvent(db, {
                workspaceId,
                projectId,
                taskId: task.id,
                type: 'handoff',
                actor: agent.name,
                verb: 'handed off to',
                object: (next.agent as unknown as { name: string })?.name ?? 'the next agent',
            });
        }

        return { status: 'done', taskId: task.id, costUsd: result.costUsd, artifactId: artifact?.id ?? null };
    } catch (err) {
        const message = (err as Error).message;

        // Running out of the day's allowance is not this task's fault and not
        // something a re-run fixes, so the task goes back in the queue rather
        // than being marked failed and needing to be found and restarted by
        // hand. The pipeline halts where it stands and picks up from here on a
        // later tick, once the quota window has rolled over.
        if (err instanceof ModelQuotaError) {
            await db
                .from('delphi_task_runs')
                .update({
                    status: 'failed',
                    error: message,
                    cost_usd: 0,
                    finished_at: new Date().toISOString(),
                })
                .eq('id', run!.id);

            await db.from('delphi_tasks').update({ status: 'pending' }).eq('id', task.id);
            await emitEvent(db, {
                workspaceId,
                projectId,
                taskId: task.id,
                type: 'task_blocked',
                actor: agent.name,
                verb: 'is waiting on model quota',
                object: message.slice(0, 200),
                durationMs: Date.now() - startedAt,
                payload: { reason: 'model_quota', models: err.models },
            });

            return { status: 'halted', reason: 'model_quota' };
        }

        // A validation failure means the model ran, and a repair round ran after
        // it — that spent real money even though nothing usable came back.
        // generateStructured throws before it can report usage, so this is
        // recorded as an unknown non-zero cost rather than silently as zero,
        // which would let repeated failures drift the budget.
        const failedSpend = err instanceof SchemaValidationError ? null : 0;

        await db
            .from('delphi_task_runs')
            .update({
                status: 'failed',
                error: message,
                ...(failedSpend === null ? {} : { cost_usd: failedSpend }),
                finished_at: new Date().toISOString(),
            })
            .eq('id', run!.id);

        await db.from('delphi_tasks').update({ status: 'failed' }).eq('id', task.id);
        await emitEvent(db, {
            workspaceId,
            projectId,
            taskId: task.id,
            type: 'task_failed',
            actor: agent.name,
            verb: 'failed',
            object: message.slice(0, 160),
            durationMs: Date.now() - startedAt,
        });

        return { status: 'failed', taskId: task.id, error: message };
    }
}

/** Drive a project until it blocks, finishes, or hits `maxSteps`. */
export async function runProject(
    db: Db,
    workspaceId: string,
    projectId: string,
    maxSteps = 12
): Promise<StepOutcome[]> {
    const outcomes: StepOutcome[] = [];

    for (let i = 0; i < maxSteps; i++) {
        const outcome = await runNextTask(db, workspaceId, projectId);
        outcomes.push(outcome);
        if (outcome.status !== 'done') break;
    }
    return outcomes;
}
