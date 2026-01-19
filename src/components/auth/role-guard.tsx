"use client"

import React from 'react'
import { useWorkspace } from '@/lib/contexts/workspace-context'
import { UserRole } from '@/lib/types/tool-registry'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ShieldAlert, Lock } from 'lucide-react'
import { Button } from "@/components/ui/button"

interface RoleGuardProps {
    children: React.ReactNode
    allowedRoles: UserRole[]
}

export function RoleGuard({ children, allowedRoles }: RoleGuardProps) {
    const { currentUserRole } = useWorkspace()

    // If no roles specified, assume public/all allowed (or handle as restricted)
    // Here we assume if RoleGuard is used, restrictions apply.
    const isAllowed = allowedRoles.includes(currentUserRole)

    if (!isAllowed) {
        return (
            <div className="h-full w-full flex items-center justify-center p-6">
                <Card className="max-w-md w-full bg-black/40 border-red-500/20 backdrop-blur-xl">
                    <CardHeader className="text-center pb-2">
                        <div className="mx-auto h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                            <Lock className="h-6 w-6 text-red-500" />
                        </div>
                        <CardTitle className="text-xl text-white">Access Denied</CardTitle>
                    </CardHeader>
                    <CardContent className="text-center space-y-4">
                        <p className="text-muted-foreground">
                            Your current role <span className="text-white font-mono px-1 py-0.5 rounded bg-white/10 uppercase text-xs">{currentUserRole}</span> does not have permission to view this page.
                        </p>
                        <div className="text-xs text-muted-foreground bg-white/5 p-3 rounded border border-white/5">
                            Required Role: {allowedRoles.map(r => r.toUpperCase()).join(" or ")}
                        </div>
                        <p className="text-xs text-zinc-500">
                            (For Demo: Go to Settings to switch your role)
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return <>{children}</>
}
