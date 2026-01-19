"use client"

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { User, Building, Mail, Shield, LayoutGrid, Check, Plus, Wrench, CreditCard, AlertTriangle } from 'lucide-react'
import { useWorkspace } from '@/lib/contexts/workspace-context'
import { TOOL_REGISTRY, ToolId } from '@/lib/types/tool-registry'
import { cn } from '@/lib/utils'
import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"

export default function SettingsPage() {
    // const supabase = createClient() // This line is removed as createClient is now called inside useEffect
    const router = useRouter()
    const { activeWorkspace, updateWorkspaceTier, updateWorkspaceTools, currentUserRole, updateUserRole } = useWorkspace()
    const [user, setUser] = useState<any>(null)
    const [activeTools, setActiveTools] = useState<ToolId[]>(activeWorkspace.enabledTools)

    useEffect(() => {
        const getUser = async () => {
            const supabase = createClient() // createClient is not async, removed await

            let currentUser = null;

            if (supabase) {
                const { data } = await supabase.auth.getUser()
                currentUser = data.user
            } else {
                currentUser = { email: 'demo@delphi.com', id: 'mock-user-id' } as any
            }

            if (!currentUser) {
                router.push('/login')
                return
            }
            setUser(currentUser) // Set the user state
        }
        getUser()
    }, []) // Removed supabase from dependency array as it's created inside

    const toggleTool = (toolId: ToolId) => {
        if (activeTools.includes(toolId)) {
            setActiveTools(prev => prev.filter(id => id !== toolId))
        } else {
            setActiveTools(prev => [...prev, toolId])
        }
        // In a real app, we would save this to the backend here.
        // updateWorkspaceTools(workspaceId, newTools)
        activeWorkspace.enabledTools = activeTools.includes(toolId)
            ? activeTools.filter(id => id !== toolId)
            : [...activeTools, toolId]
    }

    if (!user) return <div className="p-8 text-muted-foreground">Loading settings...</div>

    const allTools = Object.values(TOOL_REGISTRY)

    return (
        <div className="space-y-8 max-w-5xl">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
                <p className="text-muted-foreground">
                    Manage your account settings and workspace preferences.
                </p>
            </div>

            <div className="grid gap-6">
                {/* Profile Section */}
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <User className="h-5 w-5" />
                            Profile Information
                        </CardTitle>
                        <CardDescription>
                            Your personal account details.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">Email Address</Label>
                                <div className="relative">
                                    <Mail className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="email"
                                        defaultValue={user.email}
                                        disabled
                                        className="pl-9 bg-black/20 border-white/10"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="uid">User ID</Label>
                                <div className="relative">
                                    <Shield className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="uid"
                                        defaultValue={user.id}
                                        disabled
                                        className="pl-9 bg-black/20 border-white/10 font-mono text-xs"
                                    />
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Subscription Plan (Dev/Demo) */}
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <CreditCard className="h-5 w-5" />
                            Subscription Plan
                        </CardTitle>
                        <CardDescription>
                            Manage your billing cycle and tier.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between p-3 border border-white/10 rounded-lg bg-black/20">
                            <div>
                                <div className="font-medium capitalize text-white">{activeWorkspace.tier} Plan</div>
                                <div className="text-xs text-muted-foreground">
                                    {activeWorkspace.tier === 'free' ? '$0.00 / month' :
                                        activeWorkspace.tier === 'pro' ? '$12.00 / month' : '$49.00 / month'}
                                </div>
                            </div>
                            <Badge className={cn(
                                "capitalize",
                                activeWorkspace.tier === 'free' ? "bg-blue-500/20 text-blue-400" :
                                    activeWorkspace.tier === 'pro' ? "bg-purple-500/20 text-purple-400" :
                                        "bg-emerald-500/20 text-emerald-400"
                            )}>
                                {activeWorkspace.tier}
                            </Badge>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            {['free', 'pro', 'business'].map((tier) => (
                                <Button
                                    key={tier}
                                    variant="outline"
                                    size="sm"
                                    onClick={() => updateWorkspaceTier(tier as any)}
                                    className={cn(
                                        "capitalize text-xs border-white/10 hover:bg-white/10",
                                        activeWorkspace.tier === tier && "border-primary/50 bg-primary/10 text-primary"
                                    )}
                                >
                                    {tier}
                                </Button>
                            ))}
                        </div>
                        <p className="text-[10px] text-muted-foreground text-center">
                            (Demo: Click to switch tiers instantly)
                        </p>
                    </CardContent>
                </Card>

                {/* Role Simulation (Dev/Demo) */}
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Shield className="h-5 w-5" />
                            Role Simulation
                        </CardTitle>
                        <CardDescription>
                            Test the application as different user roles.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between p-3 border border-white/10 rounded-lg bg-black/20">
                            <div>
                                <div className="font-medium capitalize text-white">{currentUserRole} Access</div>
                                <div className="text-xs text-muted-foreground">
                                    Simulating permissions for {currentUserRole}.
                                </div>
                            </div>
                            <Badge variant="outline" className="capitalize border-white/20">
                                {currentUserRole}
                            </Badge>
                        </div>

                        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                            {['owner', 'manager', 'staff', 'chef'].map((role) => (
                                <Button
                                    key={role}
                                    variant="outline"
                                    size="sm"
                                    onClick={() => updateUserRole(role as any)}
                                    className={cn(
                                        "capitalize text-xs border-white/10 hover:bg-white/10",
                                        currentUserRole === role && "border-primary/50 bg-primary/10 text-primary"
                                    )}
                                >
                                    {role}
                                </Button>
                            ))}
                        </div>
                        <p className="text-[10px] text-muted-foreground text-center">
                            (Check Sidebar to see permission changes)
                        </p>
                    </CardContent>
                </Card>

                {/* Workspace Tools Section */}
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <Wrench className="h-5 w-5" />
                                    Workspace Tools
                                </CardTitle>
                                <CardDescription>
                                    Enable or disable tools for your <strong>{activeWorkspace.name}</strong> workspace.
                                </CardDescription>
                            </div>
                            <Badge variant="outline" className="h-8 px-3 text-sm capitalize border-primary/30 bg-primary/10 text-primary">
                                {activeWorkspace.tier} Plan
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {allTools.map(tool => {
                                const isEnabled = activeTools.includes(tool.id)
                                const Icon = tool.icon
                                // Permission Logic
                                const isLocked = (activeWorkspace.tier === 'free' && tool.tier !== 'free') ||
                                    (activeWorkspace.tier === 'pro' && tool.tier === 'business')

                                return (
                                    <div
                                        key={tool.id}
                                        onClick={() => !isLocked && toggleTool(tool.id)}
                                        className={cn(
                                            "flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer select-none",
                                            isEnabled
                                                ? "bg-primary/10 border-primary/30"
                                                : "bg-white/5 border-white/5 hover:bg-white/10",
                                            isLocked && "opacity-50 cursor-not-allowed grayscale"
                                        )}
                                    >
                                        <div className={cn(
                                            "h-8 w-8 rounded-md flex items-center justify-center",
                                            isEnabled ? "bg-primary text-white" : "bg-white/10 text-muted-foreground"
                                        )}>
                                            <Icon className="h-4 w-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium leading-none mb-1 flex items-center justify-between">
                                                {tool.label}
                                                {isLocked && <span className="text-[10px] uppercase bg-white/10 px-1 rounded">Locked</span>}
                                            </div>
                                            <p className="text-xs text-muted-foreground truncate">
                                                {tool.description}
                                            </p>
                                        </div>
                                        {isEnabled && <Check className="h-4 w-4 text-primary" />}
                                    </div>
                                )
                            })}
                        </div>
                        <div className="mt-6 flex justify-end">
                            <Button
                                className="bg-white text-black hover:bg-gray-200"
                                onClick={() => {
                                    updateWorkspaceTools(activeTools)
                                    // Optional: Add toast here
                                }}
                            >
                                Save Changes
                            </Button>
                        </div>
                    </CardContent>
                </Card>
                {/* Danger Zone */}
                <Card className="border-red-500/20 bg-red-500/5 backdrop-blur-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-red-500">
                            <AlertTriangle className="h-5 w-5" />
                            Danger Zone
                        </CardTitle>
                        <CardDescription>
                            Irreversible actions for your account.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-between p-4 border border-red-500/20 rounded-lg bg-red-500/10">
                            <div>
                                <div className="font-medium text-white">Delete Account</div>
                                <div className="text-xs text-muted-foreground mt-1">
                                    Permanently remove your account and all data. this cannot be undone.
                                </div>
                            </div>
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button variant="destructive" size="sm">
                                        Delete Account
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="bg-black border-red-500/20">
                                    <DialogHeader>
                                        <DialogTitle className="text-red-500">Are you absolutely sure?</DialogTitle>
                                        <DialogDescription className="text-gray-400">
                                            This action cannot be undone. This will permanently delete your
                                            account and remove your data from our servers.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="flex justify-end gap-3 mt-4">
                                        <Button variant="outline" className="border-white/10 hover:bg-white/5">Cancel</Button>
                                        <Button variant="destructive" onClick={() => {
                                            // Demo Logic
                                            alert("Request received. In production, this would purge your data via Supabase Admin API.")
                                            router.push('/login')
                                        }}>
                                            Confirm Deletion
                                        </Button>
                                    </div>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
