/**
 * Delphi grades the work.
 *
 * This is an LLM judging an LLM, which has two well-known failure modes:
 * leniency drift, and rewarding fluent writing over correct sourcing. Both are
 * mitigated the same way — by computing what can be counted *before* asking
 * for a judgement, and handing those numbers over as fixed facts rather than
 * letting the grader form its own impression of them.
 *
 * So accuracy is not "does this feel well-sourced". It is: how many factual
 * claims did this agent make, how many carried a source locator, and how many
 * of those locators actually resolved. The grader is told the answer and asked
 * to interpret it. It cannot flatter a report that cites nothing.
 */

import { Type, type Schema } from '@google/genai';
import { generateStructured } from '@/lib/llm/gemini';
import { emitEvent, type Db, type Row } from './db';

const MODEL = 'gemini-3.8-flash';

/** Below this, a single task is enough to trigger replacement. */
export const REPLACEMENT_FLOOR = 0.45;

/** Two attempts, then it is the objective that is wrong, not the agent. */
export const MAX_REPLACEMENTS = 2;

export interface Grade {
    accuracy: number;
    completeness: number;
    adherence: number;
    efficiency: number;
    overall: number;
    reasoning: string;
    unsourcedClaims: number;
}

/** What can be counted without asking a model anything. */
export interface MechanicalFacts {
    claimCount: number;
    locatorCount: number;
    unsourcedClaims: number;
    stepCount: number;
    durationMs: number;
    costUsd: number;
    failed: boolean;
    error: string | null;
    producedArtifact: boolean;
}

const SCORE = (description: string): Schema => ({
    type: Type.NUMBER,
    description,
});

const SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        accuracy: SCORE(
            '0..1. Is every claim traceable to a real source? The unsourced-claim count below is a fact, not an opinion — a report with unsourced claims cannot score above 0.5 here.'
        ),
        completeness: SCORE('0..1. Did it deliver the whole objective, or part of it?'),
        adherence: SCORE(
            '0..1. Did it do its one job, or drift into another agent\'s lane? Doing extra work is a failure of adherence, not a bonus.'
        ),
        efficiency: SCORE('0..1. Time and cost against what this task warranted.'),
        reasoning: {
            type: Type.STRING,
            description:
                'Two or three sentences. Specific enough that the agent could argue with it. Name what was wrong, not how it felt.',
        },
    },
    required: ['accuracy', 'completeness', 'adherence', 'efficiency', 'reasoning'],
};

const SYSTEM = `You are Delphi, an AI CEO, grading one task your agent just completed.

Be exacting. These grades feed the hiring score, so a generous grade means a
worse agent gets hired next time, on your recommendation.

The counts you are given are measured, not estimated. Do not second-guess them:

- Claims without a source locator are unverifiable assertions. They are the
  single most serious defect an agent can ship here, because the whole system
  is built on being able to trace a claim back to where it came from.
- A task that failed outright scores low on completeness regardless of how
  good the partial work looks.
- Efficiency is about proportion. A cheap, fast, wrong answer is not efficient.

Grade what is in front of you. Do not imagine work that was not done.`;

function clamp01(n: unknown, fallback = 0.5): number {
    const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
    return Math.min(1, Math.max(0, v));
}

function validate(value: unknown): Omit<Grade, 'overall' | 'unsourcedClaims'> {
    const v = value as Record<string, unknown>;
    if (typeof v?.reasoning !== 'string' || !v.reasoning.trim()) {
        throw new Error('Grade came back without reasoning.');
    }
    return {
        accuracy: clamp01(v.accuracy),
        completeness: clamp01(v.completeness),
        adherence: clamp01(v.adherence),
        efficiency: clamp01(v.efficiency),
        reasoning: v.reasoning.trim(),
    };
}

/**
 * How much better than its sourcing a deliverable is allowed to look.
 *
 * Weighting accuracy at 45% was not enough on its own: a report scoring 0.3 on
 * accuracy but perfect on everything else still came out at 0.685, clear of
 * the replacement floor. That is exactly the documented failure mode of an LLM
 * grading an LLM — fluent, complete, on-brief work outvoting the question of
 * whether any of it is true.
 *
 * So accuracy is a ceiling as well as a term. Nothing can be graded much above
 * what can be verified, because a polished report you cannot check is worse
 * than a rough one you can: it is wrong in a way that looks right.
 */
const ACCURACY_HEADROOM = 0.10;

/**
 * Weighted toward what the system is actually for.
 *
 * Efficiency is deliberately the smallest term: an agent that is slow and
 * right beats one that is quick and unverifiable, and weighting cost highly
 * would invert that.
 */
export function overallOf(g: Omit<Grade, 'overall' | 'unsourcedClaims'>): number {
    const weighted =
        0.45 * g.accuracy + 0.25 * g.completeness + 0.20 * g.adherence + 0.10 * g.efficiency;
    const capped = Math.min(weighted, g.accuracy + ACCURACY_HEADROOM);
    return Math.round(Math.max(0, capped) * 1000) / 1000;
}

/**
 * A claim's sources, whichever shape it was recorded in.
 *
 * A claim used to carry one `locator`; it now carries `locators`, because a
 * comparison rests on more than one observation. Runs written before that
 * change are still in the database and still get graded and read, so both
 * shapes are understood here rather than at every call site.
 */
export function claimSources(claim: unknown): unknown[] {
    const c = (claim ?? {}) as { locator?: unknown; locators?: unknown };
    const many = Array.isArray(c.locators) ? c.locators : [];
    const one = c.locator ? [c.locator] : [];
    return [...many, ...one].filter((l) => l && typeof l === 'object');
}

/** Count what is countable, so the grader is given facts rather than vibes. */
export function measureRun(run: Row | null, artifactExists: boolean): MechanicalFacts {
    const output = (run?.output ?? {}) as {
        claims?: unknown[];
        steps?: unknown[];
    };

    const claims = Array.isArray(output.claims) ? output.claims : [];
    const withLocator = claims.filter((c) => claimSources(c).length > 0);

    const started = run?.started_at ? new Date(run.started_at as string).getTime() : 0;
    const finished = run?.finished_at ? new Date(run.finished_at as string).getTime() : 0;

    return {
        claimCount: claims.length,
        locatorCount: withLocator.length,
        unsourcedClaims: claims.length - withLocator.length,
        stepCount: Array.isArray(output.steps) ? output.steps.length : 0,
        durationMs: started && finished ? finished - started : 0,
        costUsd: Number(run?.cost_usd ?? 0),
        failed: run?.status === 'failed',
        error: (run?.error as string) ?? null,
        producedArtifact: artifactExists,
    };
}

export interface GradeResult {
    grade: Grade;
    facts: MechanicalFacts;
    costUsd: number;
}

/**
 * Grade one completed task and persist the review.
 *
 * Returns null rather than throwing: grading is reflection on work already
 * done and paid for, and a failure here must not mark a good run as bad.
 */
export async function gradeTask(
    db: Db,
    workspaceId: string,
    taskId: string
): Promise<GradeResult | null> {
    try {
        const { data: task } = await db
            .from('delphi_tasks')
            .select('id, title, objective, agent_id, project_id, status')
            .eq('id', taskId)
            .maybeSingle();
        if (!task) return null;

        // Already graded — a re-run of the tick must not double-write or
        // double-spend.
        const { data: existing } = await db
            .from('delphi_performance_reviews')
            .select('id')
            .eq('task_id', taskId)
            .limit(1);
        if (existing?.length) return null;

        const [{ data: run }, { data: artifact }] = await Promise.all([
            db
                .from('delphi_task_runs')
                .select('*')
                .eq('task_id', taskId)
                .order('attempt', { ascending: false })
                .limit(1)
                .maybeSingle(),
            db
                .from('delphi_artifacts')
                .select('id, title, content_md')
                .eq('task_id', taskId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
        ]);

        const facts = measureRun(run, !!artifact);

        const prompt = [
            `OBJECTIVE: ${task.objective}`,
            `TASK: ${task.title}`,
            `STATUS: ${task.status}${facts.failed ? ` (failed: ${facts.error ?? 'unknown'})` : ''}`,
            '',
            'MEASURED FACTS (these are counted, not estimated):',
            `  factual claims made: ${facts.claimCount}`,
            `  claims carrying a source locator: ${facts.locatorCount}`,
            `  UNSOURCED CLAIMS: ${facts.unsourcedClaims}`,
            `  reasoning steps recorded: ${facts.stepCount}`,
            `  produced a deliverable: ${facts.producedArtifact ? 'yes' : 'no'}`,
            `  duration: ${(facts.durationMs / 1000).toFixed(1)}s`,
            `  cost: $${facts.costUsd.toFixed(4)}`,
            '',
            'DELIVERABLE:',
            artifact?.content_md
                ? String(artifact.content_md).slice(0, 6000)
                : '(none was produced)',
        ].join('\n');

        const result = await generateStructured(prompt, SCHEMA, validate, {
            system: SYSTEM,
            model: MODEL,
            temperature: 0.2,
        });

        // A hard ceiling the grader cannot talk its way past. Unsourced claims
        // are the defect this whole system exists to prevent, so leniency there
        // is not a judgement call the model gets to make.
        const accuracy =
            facts.unsourcedClaims > 0
                ? Math.min(result.data.accuracy, 0.5)
                : result.data.accuracy;

        const scored = { ...result.data, accuracy };
        const grade: Grade = {
            ...scored,
            overall: overallOf(scored),
            unsourcedClaims: facts.unsourcedClaims,
        };

        await db.from('delphi_performance_reviews').insert({
            workspace_id: workspaceId,
            task_id: taskId,
            task_run_id: (run?.id as string) ?? null,
            agent_id: task.agent_id,
            accuracy_score: grade.accuracy,
            completeness_score: grade.completeness,
            adherence_score: grade.adherence,
            efficiency_score: grade.efficiency,
            overall: grade.overall,
            reasoning: grade.reasoning,
            unsourced_claims: grade.unsourcedClaims,
            triggered_replacement: false,
        });

        await rollUpQuality(db, task.agent_id as string);

        await emitEvent(db, {
            workspaceId,
            projectId: (task.project_id as string) ?? undefined,
            taskId,
            type: 'task_graded',
            actor: 'Delphi',
            verb: `graded ${(grade.overall * 100).toFixed(0)}%`,
            object: task.title as string,
            payload: {
                overall: grade.overall,
                unsourcedClaims: grade.unsourcedClaims,
                reasoning: grade.reasoning,
            },
        });

        return { grade, facts, costUsd: result.costUsd };
    } catch (err) {
        console.error('[delphi] grading failed:', (err as Error).message);
        return null;
    }
}

/**
 * Recompute an agent's average quality from its reviews.
 *
 * Read back rather than incrementally averaged, because an incremental average
 * that drifts is invisible — and this number feeds the hiring score, so a
 * silent drift changes who gets hired.
 */
async function rollUpQuality(db: Db, agentId: string): Promise<void> {
    const { data } = await db
        .from('delphi_performance_reviews')
        .select('overall')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(20);

    if (!data?.length) return;

    const avg = data.reduce((s, r) => s + Number(r.overall), 0) / data.length;
    await db
        .from('delphi_agent_stats')
        .update({ avg_quality: Math.round(avg * 1000) / 1000, updated_at: new Date().toISOString() })
        .eq('agent_id', agentId);
}
