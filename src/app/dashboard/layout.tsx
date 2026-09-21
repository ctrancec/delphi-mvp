import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { WorkspaceProvider } from '@/lib/contexts/workspace-context'
import { TimerProvider } from '@/lib/contexts/timer-context'
import { TimerWidget } from '@/components/features/freelance/timer-widget'
import { PrinterProvider } from '@/lib/printing/printer-context'
import { MockDatabaseProvider } from '@/lib/contexts/mock-db-context'
import { DashboardChrome } from '@/components/delphi/shell/chrome'
import { findWorkspace } from '@/lib/delphi/bootstrap'
import { getSystemMode, type SystemMode } from '@/lib/delphi/db'
import { countNewOutputs } from '@/lib/delphi/unread'

export const dynamic = 'force-dynamic'

const NO_STATUS = { mode: 'running' as SystemMode, spentUsd: 0, pendingApprovals: 0, newOutputs: 0 }

/**
 * What the status strip shows, tolerating a workspace that does not exist yet:
 * the very first render of a new account happens before Delphi has provisioned
 * anything.
 */
async function readStatus(
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
}

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const supabase = await createClient()

    let user: { id: string; email?: string } | null = null

    if (supabase) {
        const { data } = await supabase.auth.getUser()
        user = data.user
    } else {
        // Mock Mode Fallback
        user = { email: 'demo@delphi.com', id: 'mock-user-id' }
    }

    if (!user) {
        redirect('/login')
    }

    const status = supabase ? await readStatus(supabase, user.id) : NO_STATUS

    // The shell the pages inherited from what this codebase used to be. Built
    // here but passed through rather than rendered, so Delphi's own routes
    // never mount it and the old pages keep the chrome they were written for.
    const legacy = (
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
    )

    return (
        <WorkspaceProvider>
            <TimerProvider>
                <PrinterProvider>
                    <MockDatabaseProvider>
                        <DashboardChrome
                            legacy={legacy}
                            mode={status.mode}
                            spentUsd={status.spentUsd}
                            pendingApprovals={status.pendingApprovals}
                            newOutputs={status.newOutputs}
                            email={user.email ?? ''}
                        >
                            {children}
                        </DashboardChrome>
                    </MockDatabaseProvider>
                </PrinterProvider>
            </TimerProvider>
        </WorkspaceProvider>
    )
}
