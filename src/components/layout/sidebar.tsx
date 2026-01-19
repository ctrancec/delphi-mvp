'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
    Settings,
    LogOut
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useWorkspace } from '@/lib/contexts/workspace-context'
import { WorkspaceSwitcher } from './workspace-switcher'
import { TOOL_REGISTRY, ToolId } from '@/lib/types/tool-registry'

export function Sidebar() {
    const pathname = usePathname()
    const router = useRouter()
    const supabase = createClient()
    const { activeWorkspace, currentUserRole } = useWorkspace()

    const handleSignOut = async () => {
        if (!supabase) {
            router.push('/login')
            return
        }
        await supabase.auth.signOut()
        router.push('/login')
    }

    return (
        <div className="flex flex-col h-full w-64 border-r border-white/10 bg-black/40 backdrop-blur-xl">
            <div className="p-4">
                <WorkspaceSwitcher />
            </div>

            <div className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
                <div className="text-xs font-semibold text-muted-foreground px-3 mb-2 uppercase tracking-wide">
                    {activeWorkspace.name} ({activeWorkspace.tier})
                </div>

                {/* Dynamically Render Tools */}
                <ToolList tools={activeWorkspace.enabledTools} pathname={pathname} role={currentUserRole} />

            </div>

            <div className="p-4 border-t border-white/10 space-y-2">
                <Link
                    href="/dashboard/settings"
                    className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-white/5 text-muted-foreground hover:text-white"
                    )}
                >
                    <Settings className="h-4 w-4" />
                    Settings
                </Link>
                <button
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-red-500/10 text-muted-foreground hover:text-red-400"
                >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                </button>
            </div>
        </div>
    )
}

function ToolList({ tools, pathname, role }: { tools: ToolId[], pathname: string, role: string }) {
    if (!tools || tools.length === 0) return (
        <div className="px-3 py-4 text-sm text-muted-foreground italic">
            No tools enabled. Check settings.
        </div>
    )

    return (
        <>
            {tools.map(toolId => {
                const tool = TOOL_REGISTRY[toolId]
                if (!tool) return null

                // Role Filtering Logic
                if (tool.allowedRoles && !tool.allowedRoles.includes(role as any)) {
                    return null
                }

                const Icon = tool.icon
                const isActive = pathname === tool.href || pathname.startsWith(tool.href + '/')

                return (
                    <Link
                        key={tool.id}
                        href={tool.href}
                        className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-white/5",
                            isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-white"
                        )}
                    >
                        <Icon className="h-4 w-4" />
                        {tool.label}
                    </Link>
                )
            })}
        </>
    )
}
