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
import { toolsForChannels } from '@/lib/channels/registry';
import { emitEvent, getSystemMode, listChannels, type Db } from './db';
import type { ArtifactKind, ChannelKind, SourceLocator } from './types';

/** How long a `running` task may sit before it is presumed dead. */
const STALE_RUN_MINUTES = 10;

/** Two replacements, then the objective is the problem, not the agent. */
export const MAX_REPLACEMENTS = 2;

// ---------------------------------------------------------------------------
// Agent output contract
// ---------------------------------------------------------------------------

const LOCATOR_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        kind: { type: Type.STRING, enum: ['video', 'url', 'series', 'doc'] },
        url: { type: Type.STRING, description: 'For kind=url' },
        quote: { type: Type.STRING, description: 'The exact passage relied on, for kind=url' },
        path: { type: Type.STRING, description: 'For kind=video' },
        tMs: { type: Type.INTEGER, description: 'Milliseconds into the clip, for kind=video' },
        seriesId: { type: Type.STRING, description: 'For kind=series' },
        date: { type: Type.STRING, description: 'Observation date, for kind=series' },
        artifactId: { type: Type.STRING, description: 'For kind=doc' },
        section: { type: Type.STRING, description: 'For kind=doc' },
    },
    required: ['kind'],
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
                'Every factual assertion in your deliverable, each with the source it came from. A claim without a locator will be rejected.',
            items: {
                type: Type.OBJECT,
                properties: {
                    claim: { type: Type.STRING },
                    locator: LOCATOR_SCHEMA,
                },
                required: ['claim', 'locator'],
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
    claims: { claim: string; locator: SourceLocator }[];
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

export function validateAgentOutput(
    value: unknown,
    allowed?: Set<string>
): AgentOutput {
    const o = value as Record<string, unknown>;
    if (!o || typeof o !== 'object') throw new Error('output must be an object');

    const contentMd = String(o.contentMd ?? '').trim();
    if (!contentMd) throw new Error('contentMd is empty — the task produced no deliverable');

    const rawClaims = Array.isArray(o.claims) ? o.claims : [];
    const claims: AgentOutput['claims'] = [];
    const unsourced: string[] = [];

    const fabricated: string[] = [];

    for (const c of rawClaims) {
        const r = c as Record<string, unknown>;
        const claim = String(r.claim ?? '').trim();
        if (!claim) continue;

        const locator = validLocator(r.locator);
        if (!locator) {
            unsourced.push(claim);
            continue;
        }

        // The anti-fabrication check. An agent may only cite a source a channel
        // actually returned this run. Checking a URL's *shape* is not enough —
        // a model with no web access will happily emit a well-formed URL that
        // points nowhere. Checking it against the tool results makes inventing
        // a citation structurally impossible rather than merely detectable.
        // `doc` locators are exempt: those reference upstream artifacts in this
        // pipeline, which no channel returns.
        if (allowed && locator.kind !== 'doc' && !allowed.has(locatorKey(locator))) {
            fabricated.push(claim);
            continue;
        }

        claims.push({ claim, locator });
    }

    // The accuracy guarantee is only real if this is enforced. An agent that
    // asserts facts with no traceable source has produced unverifiable work,
    // and the repair round exists precisely to give it a chance to fix that.
    if (unsourced.length > 0) {
        throw new Error(
            `${unsourced.length} claim(s) have no valid source locator: ` +
                unsourced.slice(0, 3).map((c) => `"${c.slice(0, 80)}"`).join(', ')
        );
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
              | 'model_quota';
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

function buildPrompt(opts: {
    objective: string;
    projectBrief: string;
    upstream: { title: string; contentMd: string; handoffNote?: string } | null;
    handoffDossier: string | null;
    toolNames?: string[];
}): string {
    const parts: string[] = [];

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
    // 1. The master switch wins over everything.
    const mode = await getSystemMode(db, workspaceId);
    if (mode !== 'running') {
        return { status: 'halted', reason: mode === 'paused' ? 'system_paused' : 'system_stopped' };
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

    // 3. The upstream artifact — this is the handoff.
    //
    // A missing one is not "no input", it is a broken chain. When the two
    // researchers ahead of it failed, the staff writer was handed nothing and
    // told it was first in the pipeline, so it correctly refused to invent a
    // brief and shipped a polished statement that it had no data. That is the
    // anti-fabrication rule working and the sequencing failing: it should
    // never have been asked.
    //
    // The bar is a deliverable, not a status. A task the CHO rejected at the
    // approval gate is `skipped` but may still have produced perfectly good
    // work, and the rest of the pipeline can run on it.
    let upstream: { title: string; contentMd: string; handoffNote?: string } | null = null;
    if (task.depends_on) {
        const [{ data: prev }, { data: prevTask }] = await Promise.all([
            db
                .from('delphi_artifacts')
                .select('title, content_md, data')
                .eq('task_id', task.depends_on)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
            db
                .from('delphi_tasks')
                .select('status, title, seq')
                .eq('id', task.depends_on)
                .maybeSingle(),
        ]);

        if (prev) {
            upstream = {
                title: prev.title,
                contentMd: prev.content_md ?? '',
                handoffNote: (prev.data as Record<string, unknown>)?.handoffNote as string | undefined,
            };
        } else if (prevTask?.status !== 'done') {
            // Nothing to hand over and the step before did not finish. Stop
            // rather than spend a model call producing confident emptiness.
            const reason = `Step ${prevTask?.seq ?? '?'} (${prevTask?.title ?? 'upstream'}) is ${prevTask?.status ?? 'missing'} and produced nothing to work from.`;

            await db
                .from('delphi_projects')
                .update({ status: 'failed', error: reason, finished_at: new Date().toISOString() })
                .eq('id', projectId);

            await emitEvent(db, {
                workspaceId,
                projectId,
                taskId: task.id,
                type: 'project_failed',
                actor: 'Delphi',
                verb: 'stopped the pipeline before',
                object: `${agent.name} — ${task.title}`,
                payload: { reason },
            });

            return { status: 'halted', reason: 'upstream_failed' };
        }
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
            model: agent.model,
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

        // Every locator a channel hands back this run. Citations are checked
        // against this set, so an agent cannot invent a source.
        const allowedLocators = new Set<string>();

        const result = await generateWithTools<AgentOutput>(
            buildPrompt({
                objective: task.objective,
                projectBrief: project.brief,
                upstream,
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
                for (const loc of out.locators) allowedLocators.add(locatorKey(loc));

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
            { system: agent.system_prompt, model: agent.model, temperature: 0.4 }
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

        const { data: artifact } = await db
            .from('delphi_artifacts')
            .insert({
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
            })
            .select('id')
            .single();

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
