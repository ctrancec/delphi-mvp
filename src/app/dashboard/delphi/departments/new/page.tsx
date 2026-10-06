/**
 * Setting up a department.
 *
 * A server page so a draft can be resumed with everything it already has —
 * its kind, its settings, its channels — and so the wizard knows which
 * sources are connected and who is on the roster to pin.
 *
 *   ?draft=<id>            resume a draft, or edit a department set up before
 *   ?draft=<id>&step=4     open at a step
 *   ?draft=<id>&convert=studio   turn a department into a content studio
 */

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient, currentUser } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/delphi/bootstrap';
import { roleOf } from '@/lib/delphi/members';
import { listAgents, listChannels } from '@/lib/delphi/db';
import { listAccounts } from '@/lib/studio/accounts';
import { isDepartmentKind, roleOfAgent, withSettings, type DepartmentKind } from '@/lib/delphi/kinds';
import { Card, CardContent } from '@/components/ui/card';
import { DepartmentWizard, type WizardDraft } from '@/components/delphi/department-wizard';
import { APP_NAME } from '@/lib/pixel/cast/names';

export const dynamic = 'force-dynamic';

type Params = { draft?: string; step?: string; convert?: string };

export default async function NewDepartmentPage({ searchParams }: { searchParams: Promise<Params> }) {
    const params = await searchParams;
    const db = await createClient();
    const [user, workspaceId] = db ? await Promise.all([currentUser(), findWorkspace(db)]) : [null, null];

    const back = (
        <Link href="/dashboard/delphi" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white">
            <ArrowLeft className="h-4 w-4" /> {APP_NAME}
        </Link>
    );

    if (!db || !user || !workspaceId) {
        return (
            <div className="max-w-2xl space-y-6">
                {back}
                <Card className="border-white/10 bg-black/40">
                    <CardContent className="py-10 text-center text-muted-foreground">Sign in to set up a department.</CardContent>
                </Card>
            </div>
        );
    }

    if ((await roleOf(db, workspaceId, user.id)) !== 'owner') {
        return (
            <div className="max-w-2xl space-y-6">
                {back}
                <Card className="border-white/10 bg-black/40">
                    <CardContent className="py-10 text-center text-muted-foreground">
                        Only the workspace owner sets up departments.
                    </CardContent>
                </Card>
            </div>
        );
    }

    let draft: WizardDraft | null = null;
    if (params.draft) {
        const { data: dept } = await db
            .from('delphi_departments')
            .select('*')
            .eq('id', params.draft)
            .eq('workspace_id', workspaceId)
            .maybeSingle();
        if (dept) {
            const { data: hires } = await db.from('delphi_hires').select('id').eq('department_id', dept.id).limit(1);
            draft = {
                id: dept.id as string,
                kind: isDepartmentKind(dept.kind) ? (dept.kind as DepartmentKind) : 'research',
                name: dept.name as string,
                charter: dept.charter as string,
                budgetUsd: Number(dept.budget_usd ?? 5),
                status: String(dept.status),
                settings: withSettings(dept.settings),
                hasTeam: (hires ?? []).length > 0,
                accounts: await listAccounts(db, workspaceId, dept.id as string),
            };
        }
    }

    const [channels, agents] = await Promise.all([listChannels(db, workspaceId, true), listAgents(db, workspaceId)]);

    const convert = params.convert && isDepartmentKind(params.convert) ? params.convert : null;
    const step = Number(params.step);

    return (
        <div className="max-w-3xl space-y-6">
            {back}
            <DepartmentWizard
                draft={draft}
                convertTo={convert}
                startStep={Number.isInteger(step) && step >= 1 && step <= 5 ? step : null}
                sources={[...new Set(channels.map((c) => c.kind))]}
                roster={agents
                    .filter((a) => !a.archivedAt && a.slug !== 'delphi-ceo')
                    .map((a) => ({ slug: a.slug, name: a.name, title: a.title, role: roleOfAgent(a) }))}
            />
        </div>
    );
}
