/**
 * Replacing an agent mid-pipeline, without losing its work.
 *
 * The point is that the successor **resumes rather than restarts**. That works
 * because the task keeps its identity: same row, same `seq`, same position in
 * the chain, same downstream dependency. Only `agent_id` changes and a new
 * attempt opens. Everything the predecessor established travels forward in a
 * handoff dossier, so the replacement does not re-spend on ground already
 * covered or repeat the failure it was brought in to fix.
 *
 * Two guards matter more than they look:
 *
 * - **Replacement is capped.** If the second agent also fails a genuinely hard
 *   task you get a carousel burning budget. After two, it is the objective
 *   that is wrong, not the agent, and that is escalated rather than retried.
 * - **The successor is chosen on track record**, which the predecessor's fresh
 *   grade has just moved. An agent that keeps failing this kind of work stops
 *   being selected for it automatically.
 */

import { emitEvent, listAgents, getAgentStats, type Db, type Row } from './db';
import { hiringScore } from './delphi';
import { claimSources, MAX_REPLACEMENTS, type Grade } from './grading';
import { ESCALATION_MODEL } from '@/lib/llm/gemini';
import type { CostTier } from './types';

export interface ReplacementOutcome {
    replaced: boolean;
    /** Set when the cap is hit — nobody is swapped in, the CHO is told instead. */
    escalated?: boolean;
    fromAgent?: string;
    toAgent?: string;
    reason?: string;
}

/**
 * Should this task change hands?
 *
 * A failed run always qualifies. A completed one qualifies only on a genuinely
 * bad grade — replacing a merely mediocre agent costs a full re-run for a
 * marginal gain, and thrash is its own failure mode.
 */
export function shouldReplace(opts: {
    failed: boolean;
    grade: Grade | null;
    floor: number;
}): { replace: boolean; reason: string } {
    if (opts.failed) {
        return { replace: true, reason: 'The task failed outright.' };
    }
    if (opts.grade && opts.grade.overall < opts.floor) {
        return {
            replace: true,
            reason: `Graded ${(opts.grade.overall * 100).toFixed(0)}%, below the ${(opts.floor * 100).toFixed(0)}% floor. ${opts.grade.reasoning}`,
        };
    }
    if (opts.grade && opts.grade.unsourcedClaims > 2) {
        return {
            replace: true,
            reason: `Shipped ${opts.grade.unsourcedClaims} claims with no source. Unverifiable work is not work.`,
        };
    }
    return { replace: false, reason: '' };
}

/**
 * Pick who takes over.
 *
 * Scored the same way hiring scores, so the choice is consistent with how the
 * team was assembled in the first place — and the predecessor is excluded, as
 * is anyone already on this project, since a second opinion from the same
 * agent is not a second opinion.
 */
async function chooseSuccessor(
    db: Db,
    workspaceId: string,
    projectId: string,
    incumbentId: string,
    objective: string,
    /**
     * Escalating, rather than merely swapping.
     *
     * The ordinary score includes a cost term that prefers the cheaper agent,
     * which is right when assembling a team and exactly wrong here: the work
     * has already been refused twice, so the thing to optimise is capability,
     * not price. In this mode the cost term is inverted and anyone cheaper
     * than the incumbent is not a candidate at all.
     */
    escalate = false
): Promise<{ id: string; name: string; title: string; costTier: CostTier } | null> {
    const [agents, stats, { data: onProject }] = await Promise.all([
        listAgents(db, workspaceId),
        getAgentStats(db, workspaceId),
        db.from('delphi_tasks').select('agent_id').eq('project_id', projectId),
    ]);

    const busy = new Set((onProject ?? []).map((t) => t.agent_id as string));
    const objectiveTerms = new Set(
        objective
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter((w) => w.length > 3)
    );

    const incumbentTier = agents.find((a) => a.id === incumbentId)?.costTier ?? 1;

    const candidates = agents
        .filter((a) => a.id !== incumbentId && !busy.has(a.id))
        .filter((a) => !escalate || (a.costTier as number) >= (incumbentTier as number))
        .map((a) => {
            // Cheap skill overlap stands in for the LLM fit term: this runs
            // mid-pipeline, and a model call to pick a replacement would
            // double the cost of the failure it is recovering from.
            const overlap = a.skills.filter((s) =>
                [...objectiveTerms].some((t) => s.toLowerCase().includes(t) || t.includes(s.toLowerCase()))
            ).length;
            const fit = Math.min(1, overlap / 3);
            const base = hiringScore(fit, stats.get(a.id) ?? null, a.costTier as CostTier);
            // Capability is what is being bought now, so a dearer tier is a
            // reason to pick someone rather than a reason not to.
            const score = escalate ? base + 0.15 * ((a.costTier as number) - 1) : base;
            return { agent: a, score };
        })
        .sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (!best) return null;
    return {
        id: best.agent.id,
        name: best.agent.name,
        title: best.agent.title,
        costTier: best.agent.costTier as CostTier,
    };
}

/** What the predecessor established, so the successor does not start cold. */
async function buildDossier(
    db: Db,
    taskId: string
): Promise<{ completed: string; remaining: string; sources: unknown[]; artifactId: string | null }> {
    const [{ data: run }, { data: artifact }] = await Promise.all([
        db
            .from('delphi_task_runs')
            .select('output, error, status')
            .eq('task_id', taskId)
            .order('attempt', { ascending: false })
            .limit(1)
            .maybeSingle(),
        db
            .from('delphi_artifacts')
            .select('id, title')
            .eq('task_id', taskId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
    ]);

    const output = ((run as Row)?.output ?? {}) as {
        steps?: { step: string }[];
        claims?: unknown[];
        summary?: string;
    };

    const steps = Array.isArray(output.steps) ? output.steps : [];
    const claims = Array.isArray(output.claims) ? output.claims : [];

    const completed = steps.length
        ? steps.map((s) => `- ${s.step}`).join('\n')
        : artifact
          ? `A draft titled "${artifact.title}" exists but the working steps were not recorded.`
          : 'Nothing was established. Start from the objective.';

    const remaining = run?.status === 'failed'
        ? `The previous attempt failed: ${run.error ?? 'no error recorded'}. Everything after that point is outstanding.`
        : 'The deliverable exists but did not meet the bar. Read the reason for replacement and fix what it names, rather than rewriting from scratch.';

    return {
        completed,
        remaining,
        // Carried so the successor does not re-spend on sources already read.
        sources: claims.flatMap((c) => claimSources(c)),
        artifactId: (artifact?.id as string) ?? null,
    };
}

/**
 * Hand a task to someone else, with everything the predecessor learned.
 *
 * Never throws — a failed replacement must leave the task in a state the CHO
 * can see and act on, not take down the tick that was trying to recover it.
 */
export async function replaceAgentOnTask(
    db: Db,
    workspaceId: string,
    taskId: string,
    reason: string
): Promise<ReplacementOutcome> {
    try {
        const { data: task } = await db
            .from('delphi_tasks')
            .select('id, title, objective, agent_id, project_id, seq, replacement_count')
            .eq('id', taskId)
            .maybeSingle();
        if (!task) return { replaced: false };

        const count = Number(task.replacement_count ?? 0);

        if (count >= MAX_REPLACEMENTS) {
            // Two agents have now failed the same task. A third is unlikely to
            // be the answer; the objective probably is.
            await db.from('delphi_tasks').update({ status: 'failed' }).eq('id', taskId);
            await emitEvent(db, {
                workspaceId,
                projectId: (task.project_id as string) ?? undefined,
                taskId,
                type: 'replacement_escalated',
                actor: 'Delphi',
                verb: `stopped replacing after ${count} attempts on`,
                object: task.title as string,
                payload: {
                    reason,
                    note: 'Repeated failure on one task points at the objective, not the agent.',
                },
            });
            return { replaced: false, escalated: true, reason };
        }

        const { data: incumbent } = await db
            .from('delphi_agents')
            .select('name')
            .eq('id', task.agent_id)
            .maybeSingle();

        const successor = await chooseSuccessor(
            db,
            workspaceId,
            task.project_id as string,
            task.agent_id as string,
            task.objective as string
        );
        if (!successor) {
            await emitEvent(db, {
                workspaceId,
                projectId: (task.project_id as string) ?? undefined,
                taskId,
                type: 'replacement_escalated',
                actor: 'Delphi',
                verb: 'found no one else able to take',
                object: task.title as string,
                payload: { reason },
            });
            return { replaced: false, escalated: true, reason };
        }

        const dossier = await buildDossier(db, taskId);

        await db.from('delphi_handoffs').insert({
            workspace_id: workspaceId,
            task_id: taskId,
            from_agent_id: task.agent_id,
            to_agent_id: successor.id,
            reason,
            completed_summary: dossier.completed,
            remaining_work: dossier.remaining,
            sources_consulted: dossier.sources,
            partial_artifact_id: dossier.artifactId,
        });

        // The task keeps its identity. Same row, same seq, same dependants —
        // which is the whole reason the successor resumes rather than restarts.
        await db
            .from('delphi_tasks')
            .update({
                agent_id: successor.id,
                status: 'pending',
                replacement_count: count + 1,
            })
            .eq('id', taskId);

        await db
            .from('delphi_performance_reviews')
            .update({ triggered_replacement: true })
            .eq('task_id', taskId)
            .eq('agent_id', task.agent_id);

        await emitEvent(db, {
            workspaceId,
            projectId: (task.project_id as string) ?? undefined,
            taskId,
            type: 'agent_rehired',
            actor: 'Delphi',
            verb: `replaced ${incumbent?.name ?? 'the agent'} with`,
            object: `${successor.name} — ${task.title}`,
            payload: { reason, attempt: count + 1, resumesFrom: dossier.artifactId },
        });

        return {
            replaced: true,
            fromAgent: (incumbent?.name as string) ?? undefined,
            toAgent: successor.name,
            reason,
        };
    } catch (err) {
        console.error('[delphi] replacement failed:', (err as Error).message);
        return { replaced: false };
    }
}

/**
 * Hand a task to someone more capable, because the CHO has refused it twice.
 *
 * Distinct from `replaceAgentOnTask`, which recovers from a task that failed
 * or graded badly and looks for whoever fits best. This one is a response to
 * a person saying, twice, that the work is not good enough — so it optimises
 * for capability rather than fit, and buys it in both the ways available:
 *
 *   - **A dearer agent.** The ordinary successor score prefers the cheaper
 *     candidate, which is right when assembling a team and wrong here. In
 *     escalation mode anyone below the incumbent's tier is not a candidate,
 *     and a higher tier is a reason to pick someone.
 *   - **A stronger model,** set on the task rather than on the agent, so an
 *     agent that struggled with one objective does not become permanently
 *     more expensive everywhere else.
 *
 * Both are attempted. If the roster has nobody dearer, the incumbent keeps the
 * task and gets the better model — which is still a real change, and honest
 * about what happened. Doing nothing silently is the one outcome ruled out.
 */
export async function escalateTask(
    db: Db,
    workspaceId: string,
    taskId: string,
    reason: string
): Promise<ReplacementOutcome> {
    try {
        const { data: task } = await db
            .from('delphi_tasks')
            .select('id, title, objective, agent_id, project_id, replacement_count, model_override')
            .eq('id', taskId)
            .maybeSingle();
        if (!task) return { replaced: false };

        const { data: incumbent } = await db
            .from('delphi_agents')
            .select('name, cost_tier')
            .eq('id', task.agent_id)
            .maybeSingle();

        const successor = await chooseSuccessor(
            db,
            workspaceId,
            task.project_id as string,
            task.agent_id as string,
            task.objective as string,
            true
        );

        // The model upgrade happens either way. It is the part that does not
        // depend on the roster having someone dearer to hand.
        const alreadyEscalated = task.model_override === ESCALATION_MODEL;
        await db
            .from('delphi_tasks')
            .update({ model_override: ESCALATION_MODEL })
            .eq('id', taskId);

        if (!successor) {
            await emitEvent(db, {
                workspaceId,
                projectId: (task.project_id as string) ?? undefined,
                taskId,
                type: 'replacement_escalated',
                actor: 'Delphi',
                verb: alreadyEscalated
                    ? 'has no one stronger for'
                    : 'found no one dearer, so moved to a stronger model on',
                object: task.title as string,
                payload: { reason, model: ESCALATION_MODEL, incumbent: incumbent?.name ?? null },
            });
            return { replaced: false, escalated: true, reason };
        }

        const dossier = await buildDossier(db, taskId);

        await db.from('delphi_handoffs').insert({
            workspace_id: workspaceId,
            task_id: taskId,
            from_agent_id: task.agent_id,
            to_agent_id: successor.id,
            reason,
            completed_summary: dossier.completed,
            remaining_work: dossier.remaining,
            sources_consulted: dossier.sources,
            partial_artifact_id: dossier.artifactId,
        });

        // Same row, same seq, same dependants. The successor resumes from the
        // dossier rather than starting the objective over.
        await db
            .from('delphi_tasks')
            .update({
                agent_id: successor.id,
                status: 'pending',
                replacement_count: Number(task.replacement_count ?? 0) + 1,
            })
            .eq('id', taskId);

        await emitEvent(db, {
            workspaceId,
            projectId: (task.project_id as string) ?? undefined,
            taskId,
            type: 'agent_rehired',
            actor: 'Delphi',
            verb: `replaced ${incumbent?.name ?? 'the previous agent'} with a stronger hire on`,
            object: `${task.title} — ${successor.name}, ${successor.title}`,
            payload: {
                reason,
                from: incumbent?.name ?? null,
                to: successor.name,
                fromTier: incumbent?.cost_tier ?? null,
                toTier: successor.costTier,
                model: ESCALATION_MODEL,
            },
        });

        return { replaced: true, fromAgent: incumbent?.name as string, toAgent: successor.name, reason };
    } catch (err) {
        // Escalation is a response to work already paid for. Failing here must
        // not lose the refusal that prompted it.
        console.error('[delphi] escalation failed:', (err as Error).message);
        return { replaced: false };
    }
}
