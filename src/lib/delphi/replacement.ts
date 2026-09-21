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

import {
    emitEvent,
    getAgentStats,
    insertInventedAgent,
    listAgents,
    listChannels,
    type Db,
    type Row,
} from './db';
import { hiringScore, INVENTED_AGENT_SCHEMA, validateInventedAgent } from './delphi';
import { claimSources, MAX_REPLACEMENTS, type Grade } from './grading';
import { ESCALATION_MODEL, generateStructured } from '@/lib/llm/gemini';
import type { CostTier, InventedAgentSpec } from './types';

export interface ReplacementOutcome {
    replaced: boolean;
    /** Set when the cap is hit — nobody is swapped in, the CHO is told instead. */
    escalated?: boolean;
    fromAgent?: string;
    toAgent?: string;
    reason?: string;
    /** Set when Delphi has asked to hire someone new and is waiting on the CHO. */
    proposedHire?: string;
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
 * At least one skill genuinely overlapping the objective.
 *
 * `fit` is overlap capped at three, so this is "one of the three terms
 * matched". Anything less is a stranger to the work.
 */
const MIN_ESCALATION_FIT = 1 / 3;

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
     * This used to promote by cost tier, which was wrong in a way the roster
     * makes obvious: the only tier-3 agents are a Motion & Animation Designer
     * and a Video Editor. Tier measures what an agent costs to run media
     * through, not how well it reasons, so "escalating" a market analysis task
     * up a tier bought nothing — and the filter could exclude the genuinely
     * better-fitting candidate for a reason unrelated to the work.
     *
     * So escalation no longer means *dearer*. It means: pick on fit alone, and
     * if nobody on the roster beats the incumbent, say so, because the answer
     * is a specialist who does not exist yet rather than a reshuffle.
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

    const candidates = agents
        .filter((a) => a.id !== incumbentId && !busy.has(a.id))
        .map((a) => {
            // Cheap skill overlap stands in for the LLM fit term: this runs
            // mid-pipeline, and a model call to pick a replacement would
            // double the cost of the failure it is recovering from.
            const overlap = a.skills.filter((s) =>
                [...objectiveTerms].some((t) => s.toLowerCase().includes(t) || t.includes(s.toLowerCase()))
            ).length;
            const fit = Math.min(1, overlap / 3);
            return {
                agent: a,
                fit,
                score: hiringScore(fit, stats.get(a.id) ?? null, a.costTier as CostTier),
            };
        })
        .sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (!best) return null;

    // Escalating on somebody who does not actually fit the objective is how a
    // market analysis ends up with a motion designer. Below this, the roster
    // has no answer and the caller should draft one instead.
    if (escalate && best.fit < MIN_ESCALATION_FIT) return null;

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
 * Draft a specialist for one objective.
 *
 * Reached only when the roster has no one who genuinely fits — which, on a
 * team of fourteen generalists, is the ordinary case for work that has already
 * been refused twice. "More capable" for a given task does not mean dearer; it
 * means specified for that task, and that agent does not exist until Delphi
 * writes them.
 *
 * Nothing is hired here. The spec is returned for the CHO to consent to.
 */
async function draftSpecialist(
    db: Db,
    workspaceId: string,
    objective: string,
    reason: string,
    incumbentName: string
): Promise<InventedAgentSpec | null> {
    try {
        const kinds = (await listChannels(db, workspaceId)).map((c) => c.kind);

        const { data } = await generateStructured<InventedAgentSpec>(
            [
                'You are Delphi, the CEO. One task has now been refused twice by the CHO,',
                'and nobody on the roster is a better fit than the agent already holding it.',
                '',
                `THE TASK: ${objective}`,
                `WHO HAS IT NOW: ${incumbentName}`,
                `WHY IT KEEPS COMING BACK: ${reason}`,
                '',
                `CHANNELS AVAILABLE: ${kinds.join(', ') || 'none'}`,
                '',
                'Specify the agent you would hire to do this properly. Not a generalist with a',
                'new name — someone whose single job is exactly this, whose system prompt names',
                'the failure above and how they avoid it, and whose skills are the ones the',
                'objective actually calls for. Request only channels from the list.',
            ].join('\n'),
            INVENTED_AGENT_SCHEMA,
            (value) => validateInventedAgent(value),
            { temperature: 0.4 }
        );

        return data;
    } catch (err) {
        // A draft that could not be written is not a reason to lose the
        // refusal that prompted it. The incumbent keeps the task on the
        // stronger model, which the caller has already arranged.
        console.error('[delphi] could not draft a specialist:', (err as Error).message);
        return null;
    }
}

/**
 * Put a proposed hire in front of the CHO.
 *
 * Delphi may decide the roster is not good enough. It may not act on that by
 * itself — hiring spends money on every future run, and the rule that has held
 * since the first department is that Delphi never staffs itself into spending.
 * So the task waits here rather than quietly running the incumbent again.
 *
 * Filed as `other` rather than a new action type: a hire is genuinely not one
 * of the outward-facing actions the enum names, and the payload says what it
 * is.
 */
async function proposeHire(
    db: Db,
    workspaceId: string,
    task: { id: string; title: string; project_id: string | null },
    spec: InventedAgentSpec,
    incumbentName: string,
    reason: string
): Promise<boolean> {
    const { error } = await db.from('delphi_approvals').insert({
        workspace_id: workspaceId,
        project_id: task.project_id,
        task_id: task.id,
        action_type: 'other',
        summary: `Hire ${spec.name}, ${spec.title}, to take over "${task.title}"`,
        risk: 'medium',
        // Written rather than left to the column default: the guard against
        // proposing twice reads this back, and a rule that depends on a
        // default it never states is a rule waiting to be broken by a schema
        // change nobody connects to it.
        status: 'pending',
        payload: {
            kind: 'staffing',
            spec,
            incumbent: incumbentName,
            reason,
        },
    });

    if (error) {
        console.error('[delphi] could not propose a hire:', error.message);
        return false;
    }

    await db.from('delphi_tasks').update({ status: 'awaiting_approval' }).eq('id', task.id);

    await emitEvent(db, {
        workspaceId,
        projectId: task.project_id ?? undefined,
        taskId: task.id,
        type: 'approval_requested',
        actor: 'Delphi',
        verb: 'wants to hire someone new for',
        object: `${task.title} — ${spec.name}, ${spec.title}`,
        payload: { kind: 'staffing', reason: spec.reason },
    });

    return true;
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

        const incumbentName = (incumbent?.name as string) ?? 'the current agent';

        if (!successor) {
            // Nobody on the roster fits. That is not a dead end — it is the
            // case the invention path exists for, and the one the CHO asked
            // to be handled by hiring rather than by shuffling.
            //
            // Unless we already asked. A second proposal for the same task
            // would be Delphi pestering the CHO about a decision they have not
            // made yet.
            const { data: asked } = await db
                .from('delphi_approvals')
                .select('id')
                .eq('task_id', taskId)
                .eq('status', 'pending')
                .limit(1);

            if (!asked?.length) {
                const spec = await draftSpecialist(
                    db,
                    workspaceId,
                    task.objective as string,
                    reason,
                    incumbentName
                );

                if (
                    spec &&
                    (await proposeHire(
                        db,
                        workspaceId,
                        {
                            id: taskId,
                            title: task.title as string,
                            project_id: (task.project_id as string) ?? null,
                        },
                        spec,
                        incumbentName,
                        reason
                    ))
                ) {
                    return { replaced: false, escalated: true, reason, proposedHire: spec.name };
                }
            }

            // Either we have already asked, or the draft could not be written.
            // The incumbent keeps the task with the stronger model, which was
            // set above and is still a real change.
            await emitEvent(db, {
                workspaceId,
                projectId: (task.project_id as string) ?? undefined,
                taskId,
                type: 'replacement_escalated',
                actor: 'Delphi',
                verb: alreadyEscalated
                    ? 'has no one else for'
                    : 'found no one better, so moved to a stronger model on',
                object: task.title as string,
                payload: { reason, model: ESCALATION_MODEL, incumbent: incumbentName },
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
            verb: `replaced ${incumbentName} with a better-fitting agent on`,
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

        return { replaced: true, fromAgent: incumbentName, toAgent: successor.name, reason };
    } catch (err) {
        // Escalation is a response to work already paid for. Failing here must
        // not lose the refusal that prompted it.
        console.error('[delphi] escalation failed:', (err as Error).message);
        return { replaced: false };
    }
}

/**
 * The CHO said yes. Hire them.
 *
 * Only ever reached from `decideApprovalAction`, under the CHO's own session —
 * Delphi cannot call this, which is the whole point of the proposal sitting in
 * a queue rather than the roster simply growing.
 *
 * The new agent is permanent (`origin='invented'`), so a specialist drafted
 * for one stubborn task is available to every department after it. That is the
 * roster learning what the work actually needs.
 */
export async function hireProposedAgent(
    db: Db,
    workspaceId: string,
    approval: { task_id: string | null; project_id: string | null; payload: unknown }
): Promise<ReplacementOutcome> {
    const payload = (approval.payload ?? {}) as { kind?: string; spec?: unknown; reason?: string };
    if (payload.kind !== 'staffing' || !approval.task_id) return { replaced: false };

    try {
        const spec = validateInventedAgent(payload.spec);

        const { data: task } = await db
            .from('delphi_tasks')
            .select('id, title, agent_id, project_id, replacement_count, department_id')
            .eq('id', approval.task_id)
            .maybeSingle();
        if (!task) return { replaced: false };

        const { data: incumbent } = await db
            .from('delphi_agents')
            .select('name')
            .eq('id', task.agent_id)
            .maybeSingle();

        const hired = await insertInventedAgent(
            db,
            workspaceId,
            spec,
            (task.department_id as string) ?? null
        );

        // Same row, same seq, same dependants: the specialist resumes from the
        // dossier rather than starting the objective from nothing.
        const dossier = await buildDossier(db, approval.task_id);
        await db.from('delphi_handoffs').insert({
            workspace_id: workspaceId,
            task_id: approval.task_id,
            from_agent_id: task.agent_id,
            to_agent_id: hired.id,
            reason: payload.reason ?? 'The CHO approved a specialist for this task.',
            completed_summary: dossier.completed,
            remaining_work: dossier.remaining,
            sources_consulted: dossier.sources,
            partial_artifact_id: dossier.artifactId,
        });

        await db
            .from('delphi_tasks')
            .update({
                agent_id: hired.id,
                status: 'pending',
                replacement_count: Number(task.replacement_count ?? 0) + 1,
                model_override: ESCALATION_MODEL,
            })
            .eq('id', approval.task_id);

        await emitEvent(db, {
            workspaceId,
            projectId: (task.project_id as string) ?? undefined,
            taskId: approval.task_id,
            type: 'agent_invented',
            actor: 'Delphi',
            verb: 'hired, with the CHO’s approval, for',
            object: `${task.title} — ${hired.name}, ${hired.title}`,
            payload: { from: incumbent?.name ?? null, to: hired.name, why: spec.reason },
        });

        return {
            replaced: true,
            fromAgent: (incumbent?.name as string) ?? undefined,
            toAgent: hired.name,
            reason: spec.reason,
        };
    } catch (err) {
        console.error('[delphi] could not hire the approved agent:', (err as Error).message);
        return { replaced: false };
    }
}
