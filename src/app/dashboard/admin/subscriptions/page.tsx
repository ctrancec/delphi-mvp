"use client"

import { useWorkspace } from '@/lib/contexts/workspace-context'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Shield, Settings2, Check } from "lucide-react"
import { RoleGuard } from '@/components/auth/role-guard'
import { SubscriptionTier } from '@/lib/contexts/workspace-context'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export default function SubscriptionAdminPage() {
    return (
        <RoleGuard allowedRoles={['owner']}>
            <SubscriptionAdminContent />
        </RoleGuard>
    )
}

function SubscriptionAdminContent() {
    const { workspaces, updateWorkspace } = useWorkspace()

    const handleUpdateTier = (workspaceId: string, tier: SubscriptionTier) => {
        updateWorkspace(workspaceId, { tier })
    }

    const tiers: SubscriptionTier[] = ['free', 'pro', 'business', 'enterprise']

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Subscription Administration</h2>
                <p className="text-muted-foreground">
                    Global overview of all workspaces and their subscription tiers.
                </p>
            </div>

            <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5 text-indigo-400" />
                        Workspace Registry
                    </CardTitle>
                    <CardDescription>
                        Manage tiers and overrides for customer workspaces.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border border-white/10 bg-black/20">
                        <Table>
                            <TableHeader className="bg-white/5">
                                <TableRow className="border-white/10 hover:bg-transparent">
                                    <TableHead className="text-white">Workspace Name</TableHead>
                                    <TableHead className="text-white">ID</TableHead>
                                    <TableHead className="text-white">Current Tier</TableHead>
                                    <TableHead className="text-right text-white">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {workspaces.map((ws) => (
                                    <TableRow key={ws.id} className="border-white/10 hover:bg-white/5">
                                        <TableCell className="font-medium text-white">
                                            <div className="flex items-center gap-3">
                                                <div className="h-8 w-8 rounded bg-white/10 flex items-center justify-center text-white/50">
                                                    <ws.icon className="h-4 w-4" />
                                                </div>
                                                {ws.name}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground font-mono text-xs">
                                            {ws.id}
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                className={`capitalize ${ws.tier === 'enterprise' ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/50' :
                                                    ws.tier === 'business' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' :
                                                        ws.tier === 'pro' ? 'bg-purple-500/20 text-purple-400 border-purple-500/50' :
                                                            'bg-blue-500/20 text-blue-400 border-blue-500/50'
                                                    }`}
                                                variant="outline"
                                            >
                                                {ws.tier}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-white">
                                                            <Settings2 className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="bg-zinc-950 border-white/10 text-white w-40">
                                                        <DropdownMenuLabel>Set Tier</DropdownMenuLabel>
                                                        <DropdownMenuSeparator className="bg-white/10" />
                                                        {tiers.map((t) => (
                                                            <DropdownMenuItem
                                                                key={t}
                                                                disabled={ws.tier === t}
                                                                onClick={() => handleUpdateTier(ws.id, t)}
                                                                className={cn(
                                                                    "capitalize cursor-pointer gap-2",
                                                                    ws.tier === t ? "bg-white/10" : "hover:bg-white/10"
                                                                )}
                                                            >
                                                                {t}
                                                                {ws.tier === t && <Check className="h-3 w-3 ml-auto text-primary" />}
                                                            </DropdownMenuItem>
                                                        ))}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
