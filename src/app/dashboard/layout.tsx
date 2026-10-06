import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient, currentUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { WorkspaceProvider } from '@/lib/contexts/workspace-context'
import { TimerProvider } from '@/lib/contexts/timer-context'
import { TimerWidget } from '@/components/features/freelance/timer-widget'
import { PrinterProvider } from '@/lib/printing/printer-context'
import { MockDatabaseProvider } from '@/lib/contexts/mock-db-context'
import { DashboardChrome } from '@/components/delphi/shell/chrome'
import { LOOK_COOKIE, lookFrom } from '@/components/delphi/shell/look-cookie'
import { findWorkspace } from '@/lib/delphi/bootstrap'
import { getSystemMode, type SystemMode } from '@/lib/delphi/db'
import { countNewOutputs } from '@/lib/delphi/unread'
import { choNameOf } from '@/lib/delphi/cho'
import { roleOf, type Role } from '@/lib/delphi/members'
import { ZoneSync } from '@/components/delphi/zone-sync'

export const dynamic = 'force-dynamic'

const NO_STATUS = { mode: 'running' as SystemMode, spentUsd: 0, pendingApprovals: 0, newOutputs: 0 }

/**
 * What the status strip shows, tolerating a workspace that does not exist yet:
 * the very first render of a new account happens before Delphi has provisioned
 * anything.
 */
const readStatus = cache(async function readStatus(
    db: NonNullable<Awaited<ReturnType<typeof createClient>>>,
    userId: string
) {
    try {
        // Read only. The Delphi page is the sole creator; see bootstrap.ts.
        const workspaceId = await findWorkspace(db)
        if (!workspaceId) return NO_STATUS

        const [mode, { data: depts }, { data: approvals }, work] = await Promise.all([
            getSystemMode(db, workspaceId),
            db.from('delphi_departments').select('spent_usd'),
            db.from('delphi_approvals').select('id').eq('status', 'pending'),
            countNewOutputs(db, workspaceId, userId),
        ])

        return {
            mode,
            spentUsd: (depts ?? []).reduce((sum, d) => sum + Number(d.spent_usd ?? 0), 0),
            pendingApprovals: approvals?.length ?? 0,
            newOutputs: work.newOutputs,
        }
    } catch (err) {
        // Chrome has to render even when Delphi's tables cannot be read, or one
        // schema problem takes down the whole dashboard instead of one panel.
        console.error('[delphi] could not read system status:', (err as Error).message)
        return NO_STATUS
    }
})

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const supabase = await createClient()

    // Resolved once per request rather than once per caller: `getUser()` is a
    // round trip to Supabase's auth server, and the layout and the page inside
    // it were each making their own.
    const user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null = supabase
        ? await currentUser()
        : // Mock Mode Fallback
          { email: 'demo@delphi.com', id: 'mock-user-id' }

    if (!user) {
        redirect('/login')
    }

    const status = supabase ? await readStatus(supabase, user.id) : NO_STATUS
    // The owner acts; a reviewer posts; a viewer reads. Resolved once, for the chrome.
    let role: Role = 'owner'
    if (supabase) {
        try {
            const workspaceId = await findWorkspace(supabase)
            if (workspaceId) role = await roleOf(supabase, workspaceId, user.id)
        } catch {
            // Before the members migration there is only ever the owner.
        }
    }
    // Read here so the first paint is already in the right look, with no flash.
    const look = lookFrom((await cookies()).get(LOOK_COOKIE)?.value)

    // The shell the pages inherited from what this codebase used to be. Built
    // here but passed through rather than rendered, so Delphi's own routes
    // never mount it and the old pages keep the chrome they were written for.
    //
    // The four providers live in here rather than around the chrome for the
    // same reason: they are the old app's, and one of them queries Supabase
    // from the browser on mount. Wrapped around everything, every Delphi page
    // paid for context nothing on it reads.
    const legacy = (
        <WorkspaceProvider>
            <TimerProvider>
                <PrinterProvider>
                    <MockDatabaseProvider>
                        <div className="flex h-screen bg-[#0a0a0a] text-white overflow-hidden">
                            <Sidebar />
                            <div className="flex-1 flex flex-col overflow-hidden">
                                <header className="h-16 border-b border-white/10 bg-black/40 backdrop-blur-xl flex items-center px-6 justify-between">
                                    <h2 className="text-lg font-semibold">Dashboard</h2>
                                    <div className="flex items-center gap-4">
                                        <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary">
                                            {user.email?.charAt(0).toUpperCase()}
                                        </div>
                                    </div>
                                </header>
                                <main className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                                    {children}
                                </main>
                                <TimerWidget />
                            </div>
                        </div>
                    </MockDatabaseProvider>
                </PrinterProvider>
            </TimerProvider>
        </WorkspaceProvider>
    )

    return (
        <DashboardChrome
            legacy={legacy}
            mode={status.mode}
            spentUsd={status.spentUsd}
            pendingApprovals={status.pendingApprovals}
            newOutputs={status.newOutputs}
            email={user.email ?? ''}
            look={look}
            cho={choNameOf(user)}
            role={role}
        >
            {/* The workspace's time zone comes from the owner's device; nobody is asked for it. */}
            {supabase && role === 'owner' && <ZoneSync />}
            {children}
        </DashboardChrome>
    )
}
