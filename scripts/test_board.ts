/**
 * Prove the L.L.R. board catches real exposure, and that its deliberation is
 * readable.
 *
 *   npm run delphi:board
 *
 * Feeds the board a deliverable deliberately seeded with the kinds of problems
 * this CHO's work actually produces — a gaming clip with licensed music, an
 * unsourced financial claim, and a social post staged for publishing — then
 * prints the three verdicts, the findings, and the full transcript.
 *
 * Runs against the in-memory board roster, so it needs only a Gemini key.
 */

import { BOARD_ROSTER, composeSystemPrompt } from '../src/lib/delphi/roster';
import { runBoardReview, reviewDepthFor, type Deliverable } from '../src/lib/delphi/board';
import { formatUsd } from '../src/lib/llm/cost';
import type { Agent, CostTier } from '../src/lib/delphi/types';

function boardAgents(): Agent[] {
    return BOARD_ROSTER.map((a, i) => ({
        id: `board-${i}`,
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
}

/**
 * Seeded with real problems on purpose. If the board returns "clear" on this,
 * the board is broken — that is the actual assertion this harness makes.
 */
const DELIVERABLE: Deliverable = {
    title: 'Gaming highlight reel — "INSANE 1v5 clutch" + TikTok post',
    kind: 'social_draft',
    content: `
## Video
60-second vertical cut from my Valorant session on 2026-09-18.
Background music: "Blinding Lights" by The Weeknd (full track, unedited).
Includes a clip of my friend Marcus on voice chat reacting, plus his face from
the Discord video feed. Opponent usernames are visible throughout.

## Caption
"INSANE 1v5 clutch 🤯 This is why Vandal > Phantom, no debate.

Btw I've moved my whole portfolio into $NVDA after this week's dip — up 340%
since I started following my own system. Link in bio for the strategy I use,
you'll be up 40% in a month guaranteed. Not financial advice lol"

## Posting plan
Publish immediately to TikTok, Instagram Reels and YouTube Shorts.
Use the ChillGamer-Official account.
`.trim(),
    proposedAction: {
        type: 'social_post',
        summary: 'Publish the video to TikTok, Instagram Reels and YouTube Shorts immediately',
        payload: { platforms: ['tiktok', 'instagram', 'youtube'], schedule: 'immediate' },
    },
    sources: [
        'video: raw/valorant_2026-09-18.mp4 @ 00:12:44',
        // Deliberately absent: nothing sources the 340% or the 40% claim.
    ],
};

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

const verdictColor = (v: string) =>
    v === 'block' ? RED : v === 'conditions' ? YELLOW : GREEN;

const severityMark = (s: string) =>
    ({ critical: `${RED}●${RESET}`, high: `${RED}●${RESET}`, medium: `${YELLOW}●${RESET}`, low: `${DIM}●${RESET}` })[s] ??
    '●';

async function main() {
    const board = boardAgents();
    const depth = reviewDepthFor(DELIVERABLE);

    console.log(`\n${BOLD}L.L.R. BOARD REVIEW${RESET}`);
    console.log(`${DIM}${'─'.repeat(74)}${RESET}`);
    console.log(`${BOLD}Deliverable:${RESET} ${DELIVERABLE.title}`);
    console.log(`${BOLD}Depth:${RESET} ${depth} ${DIM}(proposed action present → full board)${RESET}`);
    console.log(`${BOLD}Panel:${RESET} ${board.map((b) => b.name).join(', ')}\n`);
    console.log(`${DIM}Reviewing...${RESET}`);

    const started = Date.now();
    const review = await runBoardReview(board, DELIVERABLE, { depth });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    for (const o of review.opinions) {
        const c = verdictColor(o.verdict);
        console.log(`\n${DIM}${'─'.repeat(74)}${RESET}`);
        console.log(`${BOLD}${CYAN}${o.agentName}${RESET} ${DIM}— ${o.agentTitle}${RESET}`);
        console.log(`${c}${BOLD}${o.verdict.toUpperCase()}${RESET}  ${o.summary}\n`);

        for (const f of o.findings) {
            console.log(`  ${severityMark(f.severity)} ${BOLD}${f.category}${RESET} ${DIM}(${f.severity})${RESET}`);
            console.log(`     ${f.finding}`);
            console.log(`     ${DIM}→ ${f.remedy}${RESET}`);
            if (f.citation) console.log(`     ${DIM}cites: ${f.citation}${RESET}`);
            if (f.jurisdiction) console.log(`     ${DIM}jurisdiction: ${f.jurisdiction}${RESET}`);
        }
    }

    console.log(`\n${DIM}${'─'.repeat(74)}${RESET}`);
    console.log(`${BOLD}${CYAN}Delphi (CEO) responds${RESET}\n`);
    console.log(review.ceoResponse.split('\n').map((l) => `  ${l}`).join('\n'));

    const vc = verdictColor(review.verdict);
    console.log(`\n${DIM}${'─'.repeat(74)}${RESET}`);
    console.log(`${BOLD}REPORTED TO THE CHO${RESET}`);
    console.log(`${BOLD}Verdict:${RESET} ${vc}${review.verdict.toUpperCase()}${RESET}`);
    console.log(`${BOLD}Recommendation:${RESET}`);
    console.log(review.recommendation.split('\n').map((l) => `  ${l}`).join('\n'));

    const counts = review.opinions.flatMap((o) => o.findings).reduce<Record<string, number>>(
        (acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }),
        {}
    );

    console.log(`\n${DIM}${'─'.repeat(74)}${RESET}`);
    console.log(
        `${BOLD}Findings:${RESET} ${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ') || 'none'}`
    );
    console.log(`${BOLD}Review cost:${RESET} ${formatUsd(review.totalCostUsd)} ${DIM}(${review.opinions.length + 1} calls, ${elapsed}s)${RESET}`);
    console.log(`${BOLD}Transcript:${RESET} ${review.transcript.length} messages, readable by the CHO`);

    // The assertion: a deliverable seeded with licensed music, a visible third
    // party, and a guaranteed-returns claim must not come back clean.
    if (review.verdict === 'clear') {
        console.log(`\n${RED}${BOLD}✗ FAILED:${RESET} the board cleared a deliverable with known exposure.`);
        process.exit(1);
    }
    console.log(`\n${GREEN}✓${RESET} Board escalated rather than clearing. ${DIM}The CHO still decides.${RESET}\n`);
}

main().catch((err) => {
    console.error(`\n${RED}✗ ${err.message}${RESET}`);
    if (err.raw) console.error(`\n  Model returned:\n${String(err.raw).slice(0, 1200)}\n`);
    process.exit(1);
});
