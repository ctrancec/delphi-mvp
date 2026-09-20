/**
 * Prove the hiring brain end to end, before any UI exists.
 *
 *   npm run delphi:hire -- "Create a news and market research department"
 *
 * Runs against the in-memory seed roster, so it needs only a Gemini key — no
 * Supabase, no migrations applied. That keeps this the fastest possible check
 * that Delphi actually staffs work sensibly.
 *
 * Prints the proposed org chart, the task chain with its handoff edges, each
 * hire's reasoning and score, and what the decision itself cost.
 */

import { ALL_SEED_AGENTS, composeSystemPrompt } from '../src/lib/delphi/roster';
import { hiringScore, proposePlan, shortlistCandidates } from '../src/lib/delphi/delphi';
import { formatUsd } from '../src/lib/llm/cost';
import type { Agent, Candidate, ChannelKind, CostTier } from '../src/lib/delphi/types';

// Channels a typical workspace has connected. Delphi may only assign work
// against these, so the plan should not reach for anything absent.
const AVAILABLE_CHANNELS: ChannelKind[] = [
    'perplexity',
    'rss',
    'fred',
    'worldmonitor',
    'gdrive',
    'telegram',
];

/** Build Candidates from the seed roster without touching the database. */
function seedCandidates(): Candidate[] {
    const agents: Agent[] = ALL_SEED_AGENTS.filter((a) => !a.board).map((a, i) => ({
        id: `seed-${i}`,
        workspaceId: 'local',
        slug: a.slug,
        name: a.name,
        title: a.title,
        avatarSeed: a.avatarSeed,
        systemPrompt: composeSystemPrompt(a),
        skills: a.skills,
        channelIds: [],
        model: a.model ?? 'gemini-3.8-flash',
        costTier: a.costTier as CostTier,
        origin: 'seed' as const,
        inventedFor: null,
        archivedAt: null,
    }));

    return agents.map((agent) => ({ agent, stats: null, skillMatch: 0 }));
}

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function bar(score: number, width = 20): string {
    const filled = Math.round(score * width);
    return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

async function main() {
    const brief =
        process.argv.slice(2).join(' ').trim() ||
        'Create a news and market research department that briefs me every weekday morning on global events and market moves.';

    console.log(`\n${BOLD}DELPHI — staffing decision${RESET}`);
    console.log(`${DIM}${'─'.repeat(72)}${RESET}`);
    console.log(`${BOLD}Brief:${RESET} ${brief}\n`);

    const all = seedCandidates();
    const shortlist = shortlistCandidates(
        all.map((c) => c.agent),
        new Map(),
        brief
    );

    console.log(`${BOLD}Shortlist${RESET} ${DIM}(${shortlist.length} of ${all.length} by skill overlap)${RESET}`);
    for (const c of shortlist.slice(0, 8)) {
        const pct = (c.skillMatch * 100).toFixed(0).padStart(3);
        console.log(
            `  ${DIM}${bar(c.skillMatch, 12)}${RESET} ${pct}%  ${c.agent.name.padEnd(18)} ${DIM}${c.agent.title}${RESET}`
        );
    }

    console.log(`\n${DIM}Asking Delphi to staff it...${RESET}`);
    const started = Date.now();

    const result = await proposePlan({
        brief,
        candidates: shortlist,
        availableChannels: AVAILABLE_CHANNELS,
    });

    const plan = result.data;
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    console.log(`\n${DIM}${'─'.repeat(72)}${RESET}`);
    console.log(`${BOLD}${CYAN}${plan.departmentName}${RESET}`);
    console.log(`${plan.summary}\n`);

    console.log(`${BOLD}The team, in order of work${RESET}\n`);

    const bySlug = new Map(shortlist.map((c) => [c.agent.slug, c]));

    for (const task of plan.tasks) {
        const candidate = task.assignedSlug ? bySlug.get(task.assignedSlug) : undefined;
        const isNew = Boolean(task.newAgent);

        const who = candidate
            ? `${candidate.agent.name} — ${candidate.agent.title}`
            : task.newAgent
              ? `${task.newAgent.name} — ${task.newAgent.title}`
              : '(unassigned)';

        const tier = candidate?.agent.costTier ?? task.newAgent?.costTier ?? 1;
        // Delphi's stated fit, not the keyword prefilter score.
        const score = hiringScore(task.fit, candidate?.stats ?? null, tier as CostTier);

        const tag = isNew ? `${YELLOW}NEW HIRE${RESET}` : `${GREEN}from roster${RESET}`;

        console.log(`  ${BOLD}${task.seq}. ${task.title}${RESET}  ${DIM}[${tag}${DIM}]${RESET}`);
        console.log(`     ${CYAN}${who}${RESET}`);
        console.log(`     ${DIM}objective:${RESET} ${task.objective}`);
        console.log(`     ${DIM}why:${RESET} ${task.rationale}`);
        console.log(
            `     ${DIM}score:${RESET} ${bar(score, 16)} ${score.toFixed(3)}  ${DIM}tier ${tier}${RESET}`
        );
        if (task.newAgent) {
            console.log(`     ${DIM}invented because:${RESET} ${task.newAgent.reason}`);
            console.log(`     ${DIM}skills:${RESET} ${task.newAgent.skills.join(', ')}`);
        }
        if (task.seq < plan.tasks.length) console.log(`     ${DIM}↓ hands off to${RESET}`);
        console.log();
    }

    console.log(`${DIM}${'─'.repeat(72)}${RESET}`);
    console.log(`${BOLD}Channels required:${RESET} ${plan.requiredChannels.join(', ') || '(none)'}`);

    // A plan that reaches for a channel the workspace lacks is a real failure,
    // not a warning — those tasks would fail at runtime.
    const missing = plan.requiredChannels.filter(
        (c) => !AVAILABLE_CHANNELS.includes(c as ChannelKind)
    );
    if (missing.length) {
        console.log(`${YELLOW}⚠ Not connected:${RESET} ${missing.join(', ')}`);
    }

    console.log(`${BOLD}Delphi's estimate:${RESET} ${formatUsd(plan.estimatedCostUsd)} to run this pipeline`);
    console.log(
        `${BOLD}This decision cost:${RESET} ${formatUsd(result.costUsd)} ` +
            `${DIM}(${result.usage.promptTokens} in / ${result.usage.completionTokens} out, ${elapsed}s${
                result.repaired ? ', needed JSON repair' : ''
            })${RESET}`
    );
    console.log();
}

main().catch((err) => {
    console.error(`\n\x1b[31m✗ ${err.message}\x1b[0m`);
    if (err.name === 'GeminiNotConfiguredError') {
        console.error('\n  Set GOOGLE_GENERATIVE_AI_API_KEY in .env.local or the environment.\n');
    } else if (err.raw) {
        console.error(`\n  Model returned:\n${String(err.raw).slice(0, 1500)}\n`);
    }
    process.exit(1);
});
