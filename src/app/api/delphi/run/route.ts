/**
 * The engine tick.
 *
 * `runNextTask` executes exactly one task and returns, so that a serverless
 * invocation can never be killed mid-agent: state lives in Postgres and a cold
 * start resumes cleanly. Something has to call it, and this is that something.
 *
 * Two callers, deliberately:
 *
 *   - **Vercel Cron**, authenticated with CRON_SECRET, acting as the system
 *     across every workspace. This is what makes departments keep to their
 *     cadence with every app closed.
 *   - **A signed-in CHO**, whose own client is used so RLS scopes the work to
 *     their workspace. The UI pokes this while a project is running, which both
 *     drives the pipeline on hosting tiers where cron is coarse and gives the
 *     CHO something to watch.
 *
 * Either way it loops until the work blocks or the time budget runs out, then
 * reports whether more remains so the caller knows to come back.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { reconcileStaleRuns, runNextTask, type StepOutcome } from '@/lib/delphi/runtime';
import type { Db } from '@/lib/delphi/db';
import { runAndStoreReview } from '@/lib/delphi/reviews';
import type { Deliverable } from '@/lib/delphi/board';

export const dynamic = 'force-dynamic';

/**
 * Vercel caps this by plan — 60s on Hobby, up to 300s on Pro — and silently
 * clamps rather than failing, so asking for more than the plan allows is safe.
 */
export const maxDuration = 300;

/** Stop with time to spare, so the response is always written. */
const TIME_BUDGET_MS = 45_000;

/** A runaway loop is a runaway bill. The budget check is the real guard; this is the backstop. */
const MAX_STEPS = 24;

interface ProjectRow {
    id: string;
    workspace_id: string;
}

async function drive(
    db: Db,
    workspaceId: string,
    deadline: number
): Promise<{ outcomes: StepOutcome[]; more: boolean }> {
    const outcomes: StepOutcome[] = [];

    // Anything that died mid-flight would otherwise block its pipeline forever.
    await reconcileStaleRuns(db, workspaceId);

    for (let step = 0; step < MAX_STEPS; step++) {
        if (Date.now() > deadline) return { outcomes, more: true };

        const { data: projects } = await db
            .from('delphi_projects')
            .select('id, workspace_id')
            .eq('workspace_id', workspaceId)
            .eq('status', 'running')
            .order('created_at', { ascending: true })
            .limit(1);

        const project = (projects?.[0] as ProjectRow | undefined) ?? null;
        if (!project) return { outcomes, more: false };

        const outcome = await runNextTask(db, workspaceId, project.id);
        outcomes.push(outcome);

        // The board reviews before the CHO sees anything, not after. Doing it
        // here rather than inside runNextTask keeps the executor to one job and
        // means a review failure cannot lose a task's recorded cost.
        if (outcome.status === 'awaiting_approval') {
            await reviewPendingApproval(db, workspaceId, project.id, outcome.approvalId);
        }

        // Only `done` means there is plausibly another task to take straight
        // away. Everything else is a stopping point: blocked on the CHO, out of
        // budget, switched off, or failed.
        if (outcome.status !== 'done') {
            return { outcomes, more: false };
        }
    }

    return { outcomes, more: true };
}


/**
 * Convene the board on a freshly parked approval.
 *
 * Failure is logged, never thrown: a review that did not run leaves the
 * approval visible and marked as unreviewed, which the CHO can act on. An
 * exception here would instead strand the whole tick.
 */
async function reviewPendingApproval(
    db: Db,
    workspaceId: string,
    projectId: string,
    approvalId: string
): Promise<void> {
    try {
        const { data: approval } = await db
            .from('delphi_approvals')
            .select('id, task_id, summary, action_type, payload')
            .eq('id', approvalId)
            .maybeSingle();
        if (!approval) return;

        // Already reviewed — a retry of the same tick must not convene twice.
        const { data: existing } = await db
            .from('delphi_reviews')
            .select('id')
            .eq('approval_id', approvalId)
            .maybeSingle();
        if (existing) return;

        // The deliverable the action would act on, so reviewers judge the work
        // rather than only its one-line summary.
        const { data: artifact } = approval.task_id
            ? await db
                  .from('delphi_artifacts')
                  .select('id, title, kind, content_md')
                  .eq('task_id', approval.task_id)
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle()
            : { data: null };

        const deliverable: Deliverable = {
            title: artifact?.title ?? approval.summary,
            kind: artifact?.kind ?? approval.action_type,
            content: artifact?.content_md ?? approval.summary,
            proposedAction: {
                type: approval.action_type as string,
                summary: approval.summary as string,
                payload: (approval.payload as Record<string, unknown>)?.raw ?? null,
            },
        };

        // Outward-facing by definition — an approval only exists because the
        // action reaches the world — so this is always a full round.
        await runAndStoreReview(
            db,
            {
                workspaceId,
                projectId,
                taskId: (approval.task_id as string) ?? null,
                artifactId: (artifact?.id as string) ?? null,
                approvalId,
                subjectKind: 'approval',
            },
            deliverable,
            'full'
        );
    } catch (err) {
        console.error('[delphi] board review failed:', (err as Error).message);
    }
}

export async function POST(req: NextRequest) {
    const deadline = Date.now() + TIME_BUDGET_MS;
    const secret = process.env.CRON_SECRET;
    const isCron = !!secret && req.headers.get('authorization') === `Bearer ${secret}`;

    if (isCron) {
        const db = createServiceClient();
        if (!db) {
            return NextResponse.json({ error: 'Service client unavailable.' }, { status: 503 });
        }

        // Acting as the system, so every workspace is in scope — and the
        // service key bypasses RLS, which is exactly why this branch is
        // reachable only with the secret.
        const { data: workspaces } = await db
            .from('delphi_projects')
            .select('workspace_id')
            .eq('status', 'running');

        const ids = [...new Set((workspaces ?? []).map((w) => w.workspace_id as string))];
        const results: Record<string, StepOutcome[]> = {};
        let more = false;

        for (const id of ids) {
            if (Date.now() > deadline) {
                more = true;
                break;
            }
            const r = await drive(db, id, deadline);
            results[id] = r.outcomes;
            more = more || r.more;
        }

        return NextResponse.json({ ok: true, via: 'cron', workspaces: ids.length, more, results });
    }

    // Otherwise it must be the CHO. Their own client means RLS decides what can
    // be read and written, so this cannot be used to drive someone else's work.
    const db = await createClient();
    if (!db) {
        return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 });
    }

    const {
        data: { user },
    } = await db.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
    }

    const workspaceId = await findWorkspace(db);
    if (!workspaceId) {
        return NextResponse.json({ ok: true, more: false, outcomes: [] });
    }

    try {
        const { outcomes, more } = await drive(db, workspaceId, deadline);
        return NextResponse.json({ ok: true, via: 'user', more, outcomes });
    } catch (err) {
        // runNextTask records ordinary failures rather than throwing, so
        // reaching here means something structural. Report it rather than
        // returning a 200 that looks like quiet success.
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}

/** Vercel Cron issues GET. Same work, same authentication. */
export async function GET(req: NextRequest) {
    return POST(req);
}
