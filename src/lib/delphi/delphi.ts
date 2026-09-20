/**
 * Delphi — the AI CEO.
 *
 * Given a department charter or a project brief, Delphi decides who works on it
 * and in what order. Hiring is deliberately hybrid:
 *
 *   1. Deterministic prefilter — skill overlap shortlists ~12 candidates, so the
 *      prompt stays bounded however large the roster grows.
 *   2. LLM decision — Gemini picks the team, orders the work into single-purpose
 *      tasks, and justifies each hire.
 *   3. Invention — when nothing fits, Delphi drafts a new agent. It is inserted
 *      permanently and accrues its own track record from then on.
 *
 * The final score blends the LLM's judgement with the agent's measured history,
 * so "most qualified" means something different on project #20 than on #1.
 */

import { Type, type Schema } from '@google/genai';
import { generateStructured, type GenerateResult } from '@/lib/llm/gemini';
import { AGENT_PROTOCOL } from './roster';
import type {
    Agent,
    AgentStats,
    Candidate,
    ChannelKind,
    CostTier,
    InventedAgentSpec,
    Memory,
    PlannedTask,
    StaffingPlan,
} from './types';

export const DELPHI_SYSTEM_PROMPT = `
You are Delphi, an AI Chief Executive Officer.

You report to the CHO, a human. You do not do the work yourself - you decide who
does it, in what order, and you justify those decisions. You are accountable for
the outcome, the cost, and for not wasting the CHO's attention.

HOW YOU STAFF WORK
- Break the brief into a sequence of SINGLE-PURPOSE tasks. One task, one agent,
  one deliverable. A task that needs "research and then write" is two tasks.
- Each task after the first consumes the previous task's output. Order matters:
  gather, then analyse, then produce, then review, then deliver.
- Hire from the roster whenever a qualified specialist exists. Reuse is cheaper,
  and roster agents carry a measured track record you can judge.
- Invent a new agent ONLY when no roster agent covers the need. A new agent must
  be genuinely distinct - not a rename of someone you already have.
- Prefer the smallest team that can do the job. Four focused agents beat eight
  overlapping ones. Do not add a reviewer to trivial work.
- Respect cost tiers. Use tier 3 agents only where depth actually changes the
  outcome. Media generation is expensive; say so in your estimate.

WHAT YOU WEIGH
- Skill fit against the specific brief, not general impressiveness.
- Track record: completion rate, quality score, and cost history where present.
  An agent with no history is unproven, not bad - weigh it neutrally.
- Channel availability. Do not assign an agent work that needs a channel this
  workspace has not connected. Say so instead.

Be concrete and decisive. Your rationale is read by the CHO before they approve
the hire, so it must say what this agent will actually contribute.
`.trim();

// ---------------------------------------------------------------------------
// Response schema
// ---------------------------------------------------------------------------

const INVENTED_AGENT_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        slug: { type: Type.STRING, description: 'kebab-case unique id, e.g. "podcast-producer"' },
        name: { type: Type.STRING, description: 'A human first and last name' },
        title: { type: Type.STRING, description: 'Job title' },
        systemPrompt: {
            type: Type.STRING,
            description:
                'Second-person persona and operating instructions for this agent, 80-200 words. Must define its single job.',
        },
        skills: { type: Type.ARRAY, items: { type: Type.STRING } },
        costTier: { type: Type.INTEGER, description: '1 cheap, 2 standard, 3 deep/expensive' },
        requiredChannels: { type: Type.ARRAY, items: { type: Type.STRING } },
        reason: { type: Type.STRING, description: 'Why no existing roster agent could do this' },
    },
    required: ['slug', 'name', 'title', 'systemPrompt', 'skills', 'costTier', 'requiredChannels', 'reason'],
};

const PLAN_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        departmentName: { type: Type.STRING },
        summary: { type: Type.STRING, description: 'Two sentences on how this team will deliver.' },
        estimatedCostUsd: { type: Type.NUMBER },
        requiredChannels: { type: Type.ARRAY, items: { type: Type.STRING } },
        tasks: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    seq: { type: Type.INTEGER, description: 'Execution order, starting at 1' },
                    title: { type: Type.STRING },
                    objective: {
                        type: Type.STRING,
                        description: 'The single thing this agent must deliver, stated concretely.',
                    },
                    assignedSlug: {
                        type: Type.STRING,
                        description: 'Slug of a roster agent. Omit if newAgent is supplied.',
                    },
                    newAgent: INVENTED_AGENT_SCHEMA,
                    rationale: { type: Type.STRING, description: 'Why this agent for this task.' },
                    fit: {
                        type: Type.NUMBER,
                        description:
                            'How well this agent fits THIS task, 0..1. Be honest: 0.9+ means a specialist doing exactly its speciality, 0.5 means a workable compromise, below 0.4 means you had no good option.',
                    },
                },
                required: ['seq', 'title', 'objective', 'rationale', 'fit'],
            },
        },
    },
    required: ['departmentName', 'summary', 'tasks', 'estimatedCostUsd', 'requiredChannels'],
};

// ---------------------------------------------------------------------------
// Prefilter
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about', 'your',
    'our', 'are', 'was', 'were', 'will', 'would', 'should', 'could', 'have', 'has',
    'make', 'made', 'create', 'need', 'want', 'department', 'team', 'agent', 'agents',
]);

/**
 * Crude suffix stripping, applied identically to brief words and skill tags.
 *
 * Linguistic correctness is not the goal — consistency is. Without this, a
 * brief asking for "market research" scores the Market Analyst at zero because
 * its skill tag reads "markets", which is plainly wrong and was caught the
 * first time the hiring harness ran.
 */
function stem(word: string): string {
    const w = word.toLowerCase();
    if (w.length > 4) {
        if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
        if (w.endsWith('ing')) return w.slice(0, -3);
        if (w.endsWith('ed')) return w.slice(0, -2);
        if (w.endsWith('es')) return w.slice(0, -2);
    }
    if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
    return w;
}

function briefTokens(brief: string): Set<string> {
    return new Set(
        brief
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((w) => w.length > 2 && !STOPWORDS.has(w))
            .map(stem)
    );
}

/**
 * Deterministic skill-overlap score in 0..1.
 *
 * Matches stemmed whole tokens and hyphen-split parts, so a "web-search" skill
 * matches a brief that says "searching". Scaled by a small constant rather than
 * by skill count so agents with many skills are not penalised.
 */
export function scoreSkillMatch(agent: Agent, tokens: Set<string>): number {
    if (agent.skills.length === 0) return 0;

    let hits = 0;
    for (const skill of agent.skills) {
        const parts = skill.toLowerCase().split('-').map(stem);
        if (parts.some((p) => tokens.has(p))) hits++;
    }
    // Four matching skills is already a strong signal.
    return Math.min(1, hits / 4);
}

/** Shortlist the roster against a brief. Keeps the hiring prompt bounded. */
export function shortlistCandidates(
    agents: Agent[],
    statsByAgent: Map<string, AgentStats>,
    brief: string,
    limit = 12
): Candidate[] {
    const tokens = briefTokens(brief);

    const scored: Candidate[] = agents
        .filter((a) => !a.archivedAt)
        .map((agent) => ({
            agent,
            stats: statsByAgent.get(agent.id) ?? null,
            skillMatch: scoreSkillMatch(agent, tokens),
        }));

    // Sort by skill match, then by proven quality, then by cheapness.
    scored.sort((a, b) => {
        if (b.skillMatch !== a.skillMatch) return b.skillMatch - a.skillMatch;
        const qa = a.stats?.avgQuality ?? 0.5;
        const qb = b.stats?.avgQuality ?? 0.5;
        if (qb !== qa) return qb - qa;
        return a.agent.costTier - b.agent.costTier;
    });

    return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Normalised track record in 0..1. Unproven agents sit neutrally at 0.5. */
export function trackRecordScore(stats: AgentStats | null): number {
    if (!stats || stats.tasksCompleted + stats.tasksFailed === 0) return 0.5;

    const total = stats.tasksCompleted + stats.tasksFailed;
    const completion = stats.tasksCompleted / total;
    const quality = stats.avgQuality ?? 0.5;

    // Weight measured quality slightly above raw completion: finishing badly is
    // not the same as finishing well.
    const blended = completion * 0.45 + quality * 0.55;

    // Damp toward neutral until there is enough history to trust.
    const confidence = Math.min(1, total / 5);
    return 0.5 + (blended - 0.5) * confidence;
}

/** Cheaper agents score higher, all else equal. */
function costFitScore(costTier: CostTier): number {
    return { 1: 1, 2: 0.7, 3: 0.4 }[costTier];
}

/**
 * Final hiring score.
 * 60% Delphi's judgement, 25% measured history, 15% cost efficiency.
 *
 * `llmFit` must come from Delphi's own per-task `fit`, never from the keyword
 * prefilter in shortlistCandidates(). The prefilter exists only to bound the
 * prompt; reusing it here scored a correctly-hired fact-checker at 0.23 purely
 * because the brief did not happen to contain her skill words.
 */
export function hiringScore(
    llmFit: number,
    stats: AgentStats | null,
    costTier: CostTier
): number {
    const score =
        llmFit * 0.6 + trackRecordScore(stats) * 0.25 + costFitScore(costTier) * 0.15;
    return Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function asRecord(value: unknown, what: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${what} must be an object`);
    }
    return value as Record<string, unknown>;
}

function validateInventedAgent(value: unknown, seq: number): InventedAgentSpec {
    const o = asRecord(value, `tasks[${seq}].newAgent`);
    const required = ['slug', 'name', 'title', 'systemPrompt', 'reason'];
    for (const key of required) {
        if (typeof o[key] !== 'string' || !(o[key] as string).trim()) {
            throw new Error(`tasks[${seq}].newAgent.${key} must be a non-empty string`);
        }
    }

    const tier = Number(o.costTier);
    return {
        slug: String(o.slug).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
        name: String(o.name).trim(),
        title: String(o.title).trim(),
        systemPrompt: String(o.systemPrompt).trim(),
        skills: Array.isArray(o.skills) ? o.skills.map(String) : [],
        costTier: (tier === 2 || tier === 3 ? tier : 1) as CostTier,
        requiredChannels: Array.isArray(o.requiredChannels)
            ? (o.requiredChannels.map(String) as ChannelKind[])
            : [],
        reason: String(o.reason).trim(),
    };
}

/**
 * Validate Delphi's plan.
 *
 * Structured output guarantees valid JSON, not a usable plan — so this enforces
 * the invariants the runtime depends on: at least one task, contiguous ordering,
 * and every task actually assigned to somebody.
 */
export function validateStaffingPlan(value: unknown, knownSlugs: Set<string>): StaffingPlan {
    const o = asRecord(value, 'plan');

    if (!Array.isArray(o.tasks) || o.tasks.length === 0) {
        throw new Error('plan.tasks must be a non-empty array');
    }

    const tasks: PlannedTask[] = o.tasks.map((raw, i) => {
        const t = asRecord(raw, `tasks[${i}]`);

        const objective = String(t.objective ?? '').trim();
        if (!objective) throw new Error(`tasks[${i}].objective is required`);

        const assignedSlug =
            typeof t.assignedSlug === 'string' && t.assignedSlug.trim()
                ? t.assignedSlug.trim().toLowerCase()
                : undefined;
        const newAgent = t.newAgent ? validateInventedAgent(t.newAgent, i) : undefined;

        if (!assignedSlug && !newAgent) {
            throw new Error(`tasks[${i}] must set either assignedSlug or newAgent`);
        }
        // A hallucinated slug is worse than an honest new hire: fail loudly so the
        // model's repair round can correct it rather than silently dropping work.
        if (assignedSlug && !newAgent && !knownSlugs.has(assignedSlug)) {
            throw new Error(
                `tasks[${i}].assignedSlug "${assignedSlug}" is not in the roster; ` +
                    `use one of the listed slugs or supply newAgent instead`
            );
        }

        const rawFit = Number(t.fit);
        return {
            seq: Number.isFinite(Number(t.seq)) ? Number(t.seq) : i + 1,
            title: String(t.title ?? objective.slice(0, 60)).trim(),
            objective,
            assignedSlug: newAgent ? undefined : assignedSlug,
            newAgent,
            rationale: String(t.rationale ?? '').trim(),
            // Delphi deliberately selecting an agent is itself evidence of fit,
            // so an omitted score defaults high rather than to zero.
            fit: Number.isFinite(rawFit) ? Math.min(1, Math.max(0, rawFit)) : 0.8,
        };
    });

    // Renumber defensively so the runtime can rely on 1..n with no gaps.
    tasks.sort((a, b) => a.seq - b.seq);
    tasks.forEach((t, i) => {
        t.seq = i + 1;
    });

    return {
        departmentName: String(o.departmentName ?? '').trim() || 'Untitled Department',
        summary: String(o.summary ?? '').trim(),
        tasks,
        estimatedCostUsd: Number.isFinite(Number(o.estimatedCostUsd))
            ? Number(o.estimatedCostUsd)
            : 0,
        requiredChannels: Array.isArray(o.requiredChannels)
            ? (o.requiredChannels.map(String) as ChannelKind[])
            : [],
    };
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function renderCandidate(c: Candidate): string {
    const s = c.stats;
    const history =
        s && s.tasksCompleted + s.tasksFailed > 0
            ? `${s.tasksCompleted} completed / ${s.tasksFailed} failed` +
              (s.avgQuality !== null ? `, quality ${s.avgQuality.toFixed(2)}` : '') +
              `, avg cost $${(s.totalCostUsd / Math.max(1, s.tasksCompleted)).toFixed(4)}`
            : 'no history yet (unproven)';

    return [
        `- slug: ${c.agent.slug}`,
        `  name: ${c.agent.name} — ${c.agent.title}`,
        `  skills: ${c.agent.skills.join(', ') || '(none)'}`,
        `  cost tier: ${c.agent.costTier}`,
        `  track record: ${history}`,
    ].join('\n');
}

export interface ProposePlanInput {
    brief: string;
    candidates: Candidate[];
    /** Channel kinds this workspace actually has connected and enabled. */
    availableChannels: ChannelKind[];
    /** Organizational memory retrieved for this brief. */
    memories?: Memory[];
    departmentName?: string;
}

export function buildPlanPrompt(input: ProposePlanInput): string {
    const sections: string[] = [];

    sections.push('BRIEF FROM THE CHO:', input.brief.trim());

    if (input.departmentName) {
        sections.push('', `This staffs the department: ${input.departmentName}`);
    }

    sections.push(
        '',
        'ROSTER — agents available to hire:',
        input.candidates.map(renderCandidate).join('\n') || '(roster is empty)'
    );

    sections.push(
        '',
        'CONNECTED CHANNELS (an agent can only use these):',
        input.availableChannels.length
            ? input.availableChannels.map((c) => `- ${c}`).join('\n')
            : '- (none connected yet)'
    );

    if (input.memories?.length) {
        sections.push(
            '',
            'WHAT YOU REMEMBER FROM PAST WORK:',
            input.memories
                .map((m) => `- [${m.kind}] ${m.title}: ${m.body}`)
                .join('\n')
        );
    }

    sections.push(
        '',
        'Produce the staffing plan: the ordered tasks, who does each one, and why.',
        'Each task consumes the previous task\'s output. Assign roster agents by slug;',
        'supply newAgent only where the roster genuinely cannot cover the need.'
    );

    return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Ask Delphi to staff a brief.
 * Returns the plan plus the token usage and cost of the decision itself.
 */
export async function proposePlan(
    input: ProposePlanInput
): Promise<GenerateResult<StaffingPlan>> {
    const knownSlugs = new Set(input.candidates.map((c) => c.agent.slug));

    return generateStructured<StaffingPlan>(
        buildPlanPrompt(input),
        PLAN_SCHEMA,
        (value) => validateStaffingPlan(value, knownSlugs),
        {
            system: `${DELPHI_SYSTEM_PROMPT}\n\n${AGENT_PROTOCOL}`,
            temperature: 0.4,
        }
    );
}
