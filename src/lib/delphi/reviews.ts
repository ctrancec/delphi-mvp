/**
 * Persisting the L.L.R. board's work.
 *
 * `runBoardReview` in ./board is pure — it takes a panel and a deliverable and
 * returns opinions, a consolidated verdict and a transcript. This is what turns
 * that into rows: the review, its findings, and the thread the deliberation
 * happened in.
 *
 * The transcript is a first-class record rather than a debugging side effect.
 * Months later, "why did we approve that?" has to be answerable.
 */

import { runBoardReview, type BoardReview, type Deliverable, type ReviewDepth } from './board';
import { emitEvent, listBoardAgents, type Db, type Row } from './db';
import { DelphiDbError } from './db';

export interface StoredReview {
    id: string;
    threadId: string | null;
    verdict: BoardReview['verdict'];
    recommendation: string;
    costUsd: number;
}

export interface ReviewSubject {
    workspaceId: string;
    projectId?: string | null;
    taskId?: string | null;
    artifactId?: string | null;
    approvalId?: string | null;
    subjectKind: 'artifact' | 'approval' | 'project';
}

/**
 * Run a board round and write it down.
 *
 * Returns null when there is no board to convene — a workspace whose roster was
 * never seeded should not silently look like it passed review.
 */
export async function runAndStoreReview(
    db: Db,
    subject: ReviewSubject,
    deliverable: Deliverable,
    depth: ReviewDepth
): Promise<StoredReview | null> {
    const board = await listBoardAgents(db, subject.workspaceId);
    if (board.length === 0) {
        console.error('[delphi] no board agents; review skipped');
        return null;
    }

    const review = await runBoardReview(board, deliverable, { depth });

    const { data: row, error } = await db
        .from('delphi_reviews')
        .insert({
            workspace_id: subject.workspaceId,
            project_id: subject.projectId ?? null,
            task_id: subject.taskId ?? null,
            artifact_id: subject.artifactId ?? null,
            approval_id: subject.approvalId ?? null,
            subject_kind: subject.subjectKind,
            depth: review.depth,
            status: 'complete',
            verdict: review.verdict,
            recommendation: review.recommendation,
            rounds: 1,
        })
        .select('id')
        .single();

    if (error) throw new DelphiDbError('storeReview', error);
    const reviewId = row.id as string;

    // Findings, with the reviewer that raised each one.
    const findings = review.opinions.flatMap((op) =>
        op.findings.map((f) => ({
            workspace_id: subject.workspaceId,
            review_id: reviewId,
            reviewer_agent_id: op.agentId,
            category: f.category,
            severity: f.severity,
            finding: f.finding,
            remedy: f.remedy,
            // The schema splits a citation into document and section. Only the
            // section is available until the legal library is populated, and a
            // finding with none is recall rather than research — the UI says so.
            citation_section: f.citation ?? null,
            jurisdiction: f.jurisdiction ?? null,
            addressed: false,
        }))
    );
    if (findings.length) {
        const { error: fErr } = await db.from('delphi_review_findings').insert(findings);
        if (fErr) console.error('[delphi] could not store findings:', fErr.message);
    }

    // The deliberation, as a readable thread.
    let threadId: string | null = null;
    const { data: thread, error: tErr } = await db
        .from('delphi_threads')
        .insert({
            workspace_id: subject.workspaceId,
            project_id: subject.projectId ?? null,
            review_id: reviewId,
            title: `Review — ${deliverable.title}`,
            status: 'open',
        })
        .select('id')
        .single();

    if (tErr) {
        console.error('[delphi] could not open review thread:', tErr.message);
    } else {
        threadId = thread.id as string;

        // delphi_messages requires exactly one author, and Delphi is the CEO
        // rather than a hired agent, so it has no row to point at. Reviewer
        // turns always store; Delphi's is attempted and allowed to fail,
        // because its consolidation is also on the review row and losing the
        // duplicate costs nothing. Migration 0003 relaxes the constraint.
        const byName = new Map(board.map((a) => [a.name, a.id]));

        const attributed = review.transcript
            .map((m) => ({ m, agentId: byName.get(m.author) ?? null }))
            .filter((x) => x.agentId !== null)
            .map(({ m, agentId }) => ({
                workspace_id: subject.workspaceId,
                thread_id: threadId,
                author_agent_id: agentId,
                author_user_id: null,
                role: m.role,
                content: m.content,
                round: m.round,
            }));

        if (attributed.length) {
            const { error: mErr } = await db.from('delphi_messages').insert(attributed);
            if (mErr) console.error('[delphi] could not store transcript:', mErr.message);
        }

        if (review.ceoResponse) {
            const { error: cErr } = await db.from('delphi_messages').insert({
                workspace_id: subject.workspaceId,
                thread_id: threadId,
                author_agent_id: null,
                author_user_id: null,
                role: 'ceo',
                content: review.ceoResponse,
                round: 1,
            });
            if (cErr) {
                console.warn(
                    "[delphi] Delphi's turn was not stored (run migration 0003 to allow unattributed authors):",
                    cErr.message
                );
            }
        }
    }

    await emitEvent(db, {
        workspaceId: subject.workspaceId,
        projectId: subject.projectId ?? undefined,
        taskId: subject.taskId ?? undefined,
        type: 'review_completed',
        actor: 'L.L.R. Board',
        verb:
            review.verdict === 'block'
                ? 'escalated to you'
                : review.verdict === 'conditions'
                  ? 'cleared with conditions'
                  : 'cleared',
        object: deliverable.title,
        payload: { verdict: review.verdict, findings: findings.length, costUsd: review.totalCostUsd },
    });

    return {
        id: reviewId,
        threadId,
        verdict: review.verdict,
        recommendation: review.recommendation,
        costUsd: review.totalCostUsd,
    };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ReviewFindingRow {
    id: string;
    category: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    finding: string;
    remedy: string;
    citation: string | null;
    reviewerName: string | null;
    reviewerTitle: string | null;
}

export interface ReviewMessage {
    id: string;
    role: 'reviewer' | 'ceo' | 'cho' | 'system';
    authorName: string;
    content: string;
    round: number;
    createdAt: string;
}

export interface ReviewRecord {
    id: string;
    subjectKind: string;
    depth: ReviewDepth;
    status: string;
    verdict: 'clear' | 'conditions' | 'block' | null;
    recommendation: string | null;
    createdAt: string;
    projectTitle: string | null;
    departmentName: string | null;
    approvalId: string | null;
    approvalSummary: string | null;
    approvalStatus: string | null;
    findings: ReviewFindingRow[];
    threadId: string | null;
}

const REVIEW_SELECT = `
    *,
    project:delphi_projects ( title, department:delphi_departments ( name ) ),
    approval:delphi_approvals ( id, summary, status )
`;

function toReview(r: Row): ReviewRecord {
    return {
        id: r.id,
        subjectKind: r.subject_kind,
        depth: r.depth,
        status: r.status,
        verdict: r.verdict ?? null,
        recommendation: r.recommendation ?? null,
        createdAt: r.created_at,
        projectTitle: r.project?.title ?? null,
        departmentName: r.project?.department?.name ?? null,
        approvalId: r.approval?.id ?? null,
        approvalSummary: r.approval?.summary ?? null,
        approvalStatus: r.approval?.status ?? null,
        findings: [],
        threadId: null,
    };
}

export async function listReviews(db: Db, limit = 50): Promise<ReviewRecord[]> {
    const { data, error } = await db
        .from('delphi_reviews')
        .select(REVIEW_SELECT)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) throw new DelphiDbError('listReviews', error);
    return (data ?? []).map(toReview);
}

export async function getReview(db: Db, id: string): Promise<ReviewRecord | null> {
    const { data, error } = await db
        .from('delphi_reviews')
        .select(REVIEW_SELECT)
        .eq('id', id)
        .maybeSingle();

    if (error) throw new DelphiDbError('getReview', error);
    if (!data) return null;

    const review = toReview(data);

    const [{ data: findings }, { data: thread }] = await Promise.all([
        db
            .from('delphi_review_findings')
            .select('*, reviewer:delphi_agents ( name, title )')
            .eq('review_id', id),
        db.from('delphi_threads').select('id').eq('review_id', id).maybeSingle(),
    ]);

    const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    review.findings = (findings ?? [])
        .map((f) => ({
            id: f.id as string,
            category: f.category as string,
            severity: f.severity as ReviewFindingRow['severity'],
            finding: f.finding as string,
            remedy: f.remedy as string,
            citation: (f.citation_section as string) ?? null,
            reviewerName: (f.reviewer as unknown as Row)?.name ?? null,
            reviewerTitle: (f.reviewer as unknown as Row)?.title ?? null,
        }))
        .sort((a, b) => order[a.severity] - order[b.severity]);

    review.threadId = (thread?.id as string) ?? null;
    return review;
}

export async function listThreadMessages(db: Db, threadId: string): Promise<ReviewMessage[]> {
    const { data, error } = await db
        .from('delphi_messages')
        .select('*, author:delphi_agents ( name )')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true });

    if (error) throw new DelphiDbError('listThreadMessages', error);

    return (data ?? []).map((m) => ({
        id: m.id as string,
        role: m.role as ReviewMessage['role'],
        authorName: (m.author as unknown as Row)?.name ?? (m.role === 'cho' ? 'You' : 'Delphi'),
        content: m.content as string,
        round: (m.round as number) ?? 0,
        createdAt: m.created_at as string,
    }));
}
