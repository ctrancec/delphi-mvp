/**
 * The consent queue.
 *
 * Anything outward-facing or irreversible stops here and waits for the CHO —
 * social posts, publishing, sends, spend, file deletion. The governing rule is
 * that the L.L.R. board advises and Delphi recommends, but only the CHO
 * decides. A `block` verdict escalates; it does not veto.
 */

import type { Db, Row } from './db';
import { DelphiDbError } from './db';

export type ApprovalAction =
    | 'social_post'
    | 'publish'
    | 'send_email'
    | 'send_message'
    | 'spend'
    | 'file_write'
    | 'file_delete'
    | 'external_api'
    | 'other';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
export type Risk = 'low' | 'medium' | 'high';

export interface PendingApproval {
    id: string;
    projectId: string | null;
    taskId: string | null;
    actionType: ApprovalAction;
    summary: string;
    payload: Record<string, unknown>;
    risk: Risk;
    status: ApprovalStatus;
    conditions: string | null;
    createdAt: string;
    decidedAt: string | null;

    // Provenance — who is asking, and on whose behalf.
    agentName: string | null;
    agentTitle: string | null;
    taskTitle: string | null;
    projectTitle: string | null;
    departmentId: string | null;
    departmentName: string | null;

    /** The board's consolidated position, when a review ran. */
    review: {
        id: string;
        verdict: 'clear' | 'conditions' | 'block' | null;
        recommendation: string | null;
        findingCount: number;
    } | null;
}

const SELECT = `
    *,
    task:delphi_tasks ( id, title, agent:delphi_agents ( name, title ) ),
    project:delphi_projects ( id, title, department:delphi_departments ( id, name ) ),
    reviews:delphi_reviews ( id, verdict, recommendation )
`;

function toApproval(r: Row): PendingApproval {
    const task = r.task ?? null;
    const project = r.project ?? null;
    const review = Array.isArray(r.reviews) ? r.reviews[0] : (r.reviews ?? null);

    return {
        id: r.id,
        projectId: r.project_id ?? null,
        taskId: r.task_id ?? null,
        actionType: r.action_type,
        summary: r.summary,
        payload: r.payload ?? {},
        risk: r.risk,
        status: r.status,
        conditions: r.conditions ?? null,
        createdAt: r.created_at,
        decidedAt: r.decided_at ?? null,

        agentName: task?.agent?.name ?? null,
        agentTitle: task?.agent?.title ?? null,
        taskTitle: task?.title ?? null,
        projectTitle: project?.title ?? null,
        departmentId: project?.department?.id ?? null,
        departmentName: project?.department?.name ?? null,

        review: review
            ? {
                  id: review.id,
                  verdict: review.verdict ?? null,
                  recommendation: review.recommendation ?? null,
                  findingCount: 0,
              }
            : null,
    };
}

export async function listApprovals(
    db: Db,
    opts: { status?: ApprovalStatus | 'all'; limit?: number } = {}
): Promise<PendingApproval[]> {
    let q = db.from('delphi_approvals').select(SELECT);
    if (opts.status && opts.status !== 'all') q = q.eq('status', opts.status);

    const { data, error } = await q
        .order('created_at', { ascending: false })
        .limit(opts.limit ?? 100);

    if (error) throw new DelphiDbError('listApprovals', error);

    const approvals = (data ?? []).map(toApproval);

    // Finding counts in one round trip rather than one query per approval.
    const reviewIds = approvals.map((a) => a.review?.id).filter(Boolean) as string[];
    if (reviewIds.length) {
        const { data: findings } = await db
            .from('delphi_review_findings')
            .select('review_id')
            .in('review_id', reviewIds);

        const counts = new Map<string, number>();
        for (const f of findings ?? []) {
            const id = f.review_id as string;
            counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        for (const a of approvals) {
            if (a.review) a.review.findingCount = counts.get(a.review.id) ?? 0;
        }
    }

    return approvals;
}

/**
 * What the approval would actually do, as something readable.
 *
 * The CHO is consenting to a specific act, so the preview has to be the real
 * payload rather than a summary of it — a caption they did not read is not a
 * caption they approved.
 */
export function previewOf(approval: PendingApproval): string | null {
    const raw = approval.payload?.raw;
    if (raw == null) return null;
    if (typeof raw === 'string') return raw;
    try {
        return JSON.stringify(raw, null, 2);
    } catch {
        return String(raw);
    }
}

export const ACTION_LABELS: Record<ApprovalAction, string> = {
    social_post: 'Post to social media',
    publish: 'Publish',
    send_email: 'Send an email',
    send_message: 'Send a message',
    spend: 'Spend money',
    file_write: 'Write a file',
    file_delete: 'Delete a file',
    external_api: 'Call an external service',
    other: 'Take an action',
};

export const RISK_STYLES: Record<Risk, string> = {
    low: 'text-emerald-400 border-emerald-400/30',
    medium: 'text-amber-400 border-amber-400/30',
    high: 'text-red-400 border-red-400/30',
};
