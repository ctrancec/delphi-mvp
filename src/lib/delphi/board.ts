/**
 * The L.L.R. Board — Liabilities, Risk & Legal.
 *
 * Sits between finished work and the CHO's approval. Three reviewers read the
 * deliverable independently, Delphi responds to what they raise, and Delphi
 * consolidates one recommendation. Everything is written to a transcript the
 * CHO can read.
 *
 * The governing rule, enforced here in code and not merely in prompts: the board
 * ADVISES. It never approves and never blocks. A `block` verdict escalates to
 * the CHO with reasoning attached. A board that could veto would quietly become
 * the decision-maker and the CHO would stop reading.
 */

import { Type, type Schema } from '@google/genai';
import { generateStructured } from '@/lib/llm/gemini';
import { AGENT_PROTOCOL, BOARD_PROTOCOL } from './roster';
import type { Agent } from './types';

export type Verdict = 'clear' | 'conditions' | 'block';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type ReviewDepth = 'full' | 'legal' | 'skip';

export interface ReviewFinding {
    category: string;
    severity: Severity;
    finding: string;
    remedy: string;
    /** Document + section from the legal reference library, when one applies. */
    citation?: string;
    jurisdiction?: string;
}

export interface ReviewerOpinion {
    agentId: string;
    agentName: string;
    agentTitle: string;
    verdict: Verdict;
    summary: string;
    findings: ReviewFinding[];
    costUsd: number;
    model: string;
}

export interface BoardReview {
    depth: ReviewDepth;
    opinions: ReviewerOpinion[];
    /** Delphi's response to what the board raised, in the transcript. */
    ceoResponse: string;
    /** The consolidated verdict Delphi reports up to the CHO. */
    verdict: Verdict;
    recommendation: string;
    transcript: TranscriptMessage[];
    totalCostUsd: number;
}

export interface TranscriptMessage {
    role: 'reviewer' | 'ceo' | 'cho' | 'system';
    author: string;
    content: string;
    round: number;
}

/** What the board is asked to review. */
export interface Deliverable {
    title: string;
    kind: string;
    content: string;
    /** What would actually happen if the CHO approves — the real payload. */
    proposedAction?: { type: string; summary: string; payload?: unknown };
    /** Source locators the upstream agents emitted, so reviewers can judge sourcing. */
    sources?: string[];
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const OPINION_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        verdict: {
            type: Type.STRING,
            enum: ['clear', 'conditions', 'block'],
            description:
                "'clear' = no concerns worth the CHO's time. 'conditions' = safe to proceed if the remedies are applied. 'block' = escalate, do not proceed as-is.",
        },
        summary: { type: Type.STRING, description: 'One or two sentences the CHO reads first.' },
        findings: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    category: { type: Type.STRING },
                    severity: { type: Type.STRING, enum: ['low', 'medium', 'high', 'critical'] },
                    finding: {
                        type: Type.STRING,
                        description: 'Specific and located, e.g. "paragraph 3 states a 4.2% return with no source".',
                    },
                    remedy: { type: Type.STRING, description: 'What to actually do about it.' },
                    citation: {
                        type: Type.STRING,
                        description:
                            'Document and section from the reference library. Omit if the library has nothing on point — never invent one.',
                    },
                    jurisdiction: { type: Type.STRING, description: 'e.g. CA, US, platform. Omit if not jurisdictional.' },
                },
                required: ['category', 'severity', 'finding', 'remedy'],
            },
        },
    },
    required: ['verdict', 'summary', 'findings'],
};

const CONSOLIDATION_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        response: {
            type: Type.STRING,
            description:
                "Your reply to the board in the shared transcript. Accept, challenge, or propose a remedy for each substantive finding. The CHO reads this.",
        },
        verdict: { type: Type.STRING, enum: ['clear', 'conditions', 'block'] },
        recommendation: {
            type: Type.STRING,
            description:
                'What you recommend the CHO do, and why, in plain language. State any conditions concretely.',
        },
    },
    required: ['response', 'verdict', 'recommendation'],
};

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function renderDeliverable(d: Deliverable): string {
    const parts = [`DELIVERABLE: ${d.title}`, `Type: ${d.kind}`, '', '--- CONTENT ---', d.content];

    if (d.proposedAction) {
        parts.push(
            '',
            '--- PROPOSED ACTION (what happens if the CHO approves) ---',
            `Type: ${d.proposedAction.type}`,
            d.proposedAction.summary,
            d.proposedAction.payload
                ? `Payload: ${JSON.stringify(d.proposedAction.payload).slice(0, 2000)}`
                : ''
        );
    }

    parts.push(
        '',
        '--- SOURCE LOCATORS FROM UPSTREAM AGENTS ---',
        d.sources?.length
            ? d.sources.map((s) => `- ${s}`).join('\n')
            : '(none supplied — treat every factual claim as unsourced)'
    );

    return parts.filter(Boolean).join('\n');
}

/**
 * Ask one reviewer for an independent opinion.
 * Reviewers do not see each other's findings — correlated opinions would defeat
 * the point of having three lenses.
 */
async function askReviewer(
    reviewer: Agent,
    deliverable: Deliverable,
    libraryContext: string | null
): Promise<ReviewerOpinion> {
    const prompt = [
        renderDeliverable(deliverable),
        '',
        libraryContext
            ? `--- REFERENCE LIBRARY (cite these; do not cite anything else) ---\n${libraryContext}`
            : '--- REFERENCE LIBRARY ---\n(empty — say so rather than citing from memory)',
        '',
        'Review this from your lens only. Be specific and proportionate.',
    ].join('\n');

    const result = await generateStructured(
        prompt,
        OPINION_SCHEMA,
        (value) => {
            const o = value as Record<string, unknown>;
            if (!o || typeof o !== 'object') throw new Error('opinion must be an object');
            const verdict = String(o.verdict ?? '');
            if (!['clear', 'conditions', 'block'].includes(verdict)) {
                throw new Error(`verdict must be clear|conditions|block, got "${verdict}"`);
            }
            const findings = Array.isArray(o.findings) ? o.findings : [];
            return {
                verdict: verdict as Verdict,
                summary: String(o.summary ?? '').trim(),
                findings: findings.map((f) => {
                    const r = f as Record<string, unknown>;
                    return {
                        category: String(r.category ?? 'general'),
                        severity: (['low', 'medium', 'high', 'critical'].includes(String(r.severity))
                            ? String(r.severity)
                            : 'medium') as Severity,
                        finding: String(r.finding ?? '').trim(),
                        remedy: String(r.remedy ?? '').trim(),
                        citation: r.citation ? String(r.citation) : undefined,
                        jurisdiction: r.jurisdiction ? String(r.jurisdiction) : undefined,
                    };
                }),
            };
        },
        {
            system: `${reviewer.systemPrompt}\n\n${AGENT_PROTOCOL}\n\n${BOARD_PROTOCOL}`,
            temperature: 0.3,
        }
    );

    return {
        agentId: reviewer.id,
        agentName: reviewer.name,
        agentTitle: reviewer.title,
        ...result.data,
        costUsd: result.costUsd,
        model: result.model,
    };
}

const CEO_REVIEW_PROMPT = `
You are Delphi, an AI Chief Executive Officer, responding to your L.L.R. board.

The board has reviewed a deliverable and raised findings. Your job is to respond
in the shared transcript the CHO will read, then consolidate one recommendation.

- Engage with each substantive finding. Accept it, challenge it with a reason, or
  propose a concrete remedy. Do not simply restate what the board said.
- You may disagree. The board advises; it does not decide. But if you overrule a
  high or critical finding, say plainly why, because the CHO will read that.
- Your consolidated verdict should be the most serious verdict the board returned
  UNLESS you have a stated reason to differ. Do not average the board down to
  something comfortable.
- The CHO decides. Never say a thing is approved. Recommend, with conditions
  stated concretely enough to act on.
- Be brief. The CHO's attention is the scarcest resource in this company.
`.trim();

/**
 * One bounded round of deliberation.
 *
 * Reviewers post in parallel, Delphi responds once and consolidates. The round
 * count is fixed at one by design: two agents disagreeing can trade turns
 * indefinitely, and an unbounded transcript costs money and gets read by nobody.
 */
export async function runBoardReview(
    board: Agent[],
    deliverable: Deliverable,
    options: { depth?: ReviewDepth; libraryContext?: string | null } = {}
): Promise<BoardReview> {
    const depth = options.depth ?? 'full';

    if (depth === 'skip') {
        return {
            depth,
            opinions: [],
            ceoResponse: '',
            verdict: 'clear',
            recommendation: 'Internal draft — no board review required.',
            transcript: [],
            totalCostUsd: 0,
        };
    }

    // Legal-only depth exists so third-party media does not pay for a full round.
    const panel =
        depth === 'legal' ? board.filter((a) => a.slug === 'llr-legal') : board;

    if (panel.length === 0) {
        throw new Error(
            `No board agents available for depth "${depth}". Seed the roster before requesting review.`
        );
    }

    // Independent opinions: reviewers must not see each other's findings.
    const opinions = await Promise.all(
        panel.map((r) => askReviewer(r, deliverable, options.libraryContext ?? null))
    );

    const transcript: TranscriptMessage[] = opinions.map((o) => ({
        role: 'reviewer' as const,
        author: `${o.agentName} (${o.agentTitle})`,
        content: [
            `Verdict: ${o.verdict.toUpperCase()}`,
            o.summary,
            ...o.findings.map(
                (f) =>
                    `  [${f.severity}] ${f.category}: ${f.finding}\n    → ${f.remedy}` +
                    (f.citation ? `\n    cites: ${f.citation}` : '')
            ),
        ].join('\n'),
        round: 1,
    }));

    const boardSummary = opinions
        .map((o) =>
            [
                `${o.agentName} — ${o.agentTitle}: ${o.verdict.toUpperCase()}`,
                o.summary,
                ...o.findings.map((f) => `  [${f.severity}] ${f.finding} → ${f.remedy}`),
            ].join('\n')
        )
        .join('\n\n');

    const consolidation = await generateStructured(
        [
            renderDeliverable(deliverable),
            '',
            '--- YOUR BOARD SAID ---',
            boardSummary,
            '',
            'Respond to the board, then give the CHO one consolidated recommendation.',
        ].join('\n'),
        CONSOLIDATION_SCHEMA,
        (value) => {
            const o = value as Record<string, unknown>;
            const verdict = String(o.verdict ?? '');
            if (!['clear', 'conditions', 'block'].includes(verdict)) {
                throw new Error(`verdict must be clear|conditions|block, got "${verdict}"`);
            }
            return {
                response: String(o.response ?? '').trim(),
                verdict: verdict as Verdict,
                recommendation: String(o.recommendation ?? '').trim(),
            };
        },
        { system: CEO_REVIEW_PROMPT, temperature: 0.3 }
    );

    transcript.push({
        role: 'ceo',
        author: 'Delphi (CEO)',
        content: consolidation.data.response,
        round: 1,
    });

    const totalCostUsd =
        opinions.reduce((sum, o) => sum + o.costUsd, 0) + consolidation.costUsd;

    return {
        depth,
        opinions,
        ceoResponse: consolidation.data.response,
        verdict: consolidation.data.verdict,
        recommendation: consolidation.data.recommendation,
        transcript,
        totalCostUsd,
    };
}

/**
 * Decide how hard to look at a deliverable.
 *
 * Tiering exists because a full board round is roughly four extra model calls;
 * defaulting everything to `full` would double the cost of routine research.
 */
export function reviewDepthFor(deliverable: Deliverable): ReviewDepth {
    // Anything that would reach the outside world or cannot be undone.
    if (deliverable.proposedAction) return 'full';

    // Third-party media carries licensing exposure even when nothing ships yet.
    if (['video', 'image', 'audio', 'social_draft'].includes(deliverable.kind)) {
        return 'legal';
    }

    // Internal drafts that go no further than the CHO.
    return 'skip';
}

/** The most serious verdict in a set — used when Delphi gives no reason to differ. */
export function worstVerdict(verdicts: Verdict[]): Verdict {
    if (verdicts.includes('block')) return 'block';
    if (verdicts.includes('conditions')) return 'conditions';
    return 'clear';
}
