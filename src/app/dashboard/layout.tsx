import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { WorkspaceProvider } from '@/lib/contexts/workspace-context'
import { TimerProvider } from '@/lib/contexts/timer-context'
import { TimerWidget } from '@/components/features/freelance/timer-widget'
import { PrinterProvider } from '@/lib/printing/printer-context'
import { MockDatabaseProvider } from '@/lib/contexts/mock-db-context'

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const supabase = await createClient()

    let user = null;

    if (supabase) {
        const { data } = await supabase.auth.getUser()
        user = data.user
    } else {
        // Mock Mode Fallback
        user = { email: 'demo@delphi.com', id: 'mock-user-id' } as any
    }

    if (!user) {
        redirect('/login')
    }

    // WorkspaceProvider will now manage the "industry" context client-side
    return (
        <WorkspaceProvider>
            <TimerProvider>
                <PrinterProvider>
                    <MockDatabaseProvider>
                        <div className="flex h-screen bg-[#0a0a0a] text-white overflow-hidden">
                            {/* Sidebar */}
                            <Sidebar />

                            {/* Main Content Area */}
                            <div className="flex-1 flex flex-col overflow-hidden">
                                {/* Header */}
                                <header className="h-16 border-b border-white/10 bg-black/40 backdrop-blur-xl flex items-center px-6 justify-between">
                                    <h2 className="text-lg font-semibold">Dashboard</h2>
                                    <div className="flex items-center gap-4">
                                        <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary">
                                            {user.email?.charAt(0).toUpperCase()}
                                        </div>
                                    </div>
                                </header>

                                {/* Page Content */}
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
}
