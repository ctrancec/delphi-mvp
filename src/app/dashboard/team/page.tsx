"use client"

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Mail, Plus, Shield, ShieldAlert, User, ChefHat, Check, X, Lock } from 'lucide-react'
import { useWorkspace } from '@/lib/contexts/workspace-context'
import { TOOL_REGISTRY, UserRole, ToolId } from '@/lib/types/tool-registry'
import { cn } from '@/lib/utils'
import { useMockDatabase } from '@/lib/contexts/mock-db-context'

// Mock Data
type TeamMember = {
    id: number
    name: string
    email: string
    role: UserRole
    status: 'Active' | 'Invited'
    avatar?: string
}

const BUSINESS_TEAM: TeamMember[] = [
    { id: 1, name: "Curtis (You)", email: "curtis@example.com", role: "owner", status: "Active" },
    { id: 2, name: "Sarah Chen", email: "sarah.c@downtowndeli.com", role: "manager", status: "Active" },
    { id: 3, name: "Mike Ross", email: "mike.r@downtowndeli.com", role: "staff", status: "Active" },
    { id: 4, name: "Chef Ramsay", email: "chef@downtowndeli.com", role: "chef", status: "Active" },
]

const PERSONAL_TEAM: TeamMember[] = [
    { id: 1, name: "Curtis (You)", email: "curtis@example.com", role: "owner", status: "Active" },
    { id: 2, name: "Spouse", email: "spouse@example.com", role: "manager", status: "Active" },
]

const ROLES: UserRole[] = ['owner', 'manager', 'staff', 'chef']

export default function TeamPage() {
    const { activeWorkspace, currentUserRole } = useWorkspace()
    const { permissions, togglePermission } = useMockDatabase()

    const [members, setMembers] = useState<TeamMember[]>(
        activeWorkspace.type === 'personal' ? PERSONAL_TEAM : BUSINESS_TEAM
    )
    const [isInviteOpen, setIsInviteOpen] = useState(false)
    const [newEmail, setNewEmail] = useState("")
    const [newRole, setNewRole] = useState<UserRole>("staff")

    // Update list when workspace changes
    useEffect(() => {
        setMembers(activeWorkspace.type === 'personal' ? PERSONAL_TEAM : BUSINESS_TEAM)
    }, [activeWorkspace])

    // Invite Logic
    const canInvite = ['owner', 'manager'].includes(currentUserRole)
    const allowedInviteRoles: UserRole[] = currentUserRole === 'owner'
        ? ['owner', 'manager', 'staff', 'chef']
        : ['staff', 'chef']

    const handleInvite = () => {
        if (!newEmail) return

        const newMember: TeamMember = {
            id: Math.random(),
            name: "Invited User",
            email: newEmail,
            role: newRole,
            status: "Invited"
        }

        setMembers([...members, newMember])
        setNewEmail("")
        setIsInviteOpen(false)
    }

    const handlePermissionToggle = (toolId: string, role: UserRole) => {
        if (currentUserRole !== 'owner') return // Only owners can edit
        togglePermission(toolId, role)
    }

    const getRoleIcon = (role: UserRole) => {
        switch (role) {
            case 'owner': return <ShieldAlert className="h-3 w-3 mr-1 text-purple-400" />
            case 'manager': return <Shield className="h-3 w-3 mr-1 text-blue-400" />
            case 'chef': return <ChefHat className="h-3 w-3 mr-1 text-orange-400" />
            default: return <User className="h-3 w-3 mr-1 text-gray-400" />
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Team Management</h2>
                    <p className="text-muted-foreground">
                        Manage usage and access for {activeWorkspace.name}.
                    </p>
                </div>
                {canInvite && (
                    <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
                        <DialogTrigger asChild>
                            <Button className="bg-primary hover:bg-primary/90 text-white">
                                <Plus className="h-4 w-4 mr-2" />
                                Invite Member
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px] bg-black/95 border-white/10 text-white">
                            <DialogHeader>
                                <DialogTitle>Invite Team Member</DialogTitle>
                                <DialogDescription className="text-muted-foreground">
                                    Send an invitation link to add a new member to this workspace.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="email">Email Address</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="colleague@company.com"
                                        value={newEmail}
                                        onChange={(e) => setNewEmail(e.target.value)}
                                        className="bg-white/5 border-white/10"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="role">Role</Label>
                                    <Select value={newRole} onValueChange={(v: UserRole) => setNewRole(v)}>
                                        <SelectTrigger className="bg-white/5 border-white/10">
                                            <SelectValue placeholder="Select a role" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-black/90 border-white/10 text-white">
                                            {allowedInviteRoles.map(role => (
                                                <SelectItem key={role} value={role} className="capitalize">
                                                    {role}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsInviteOpen(false)} className="border-white/10 hover:bg-white/5">Cancel</Button>
                                <Button onClick={handleInvite} className="bg-primary text-white hover:bg-primary/90">Send Invitation</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                )}
            </div>

            <Tabs defaultValue="members" className="w-full">
                <TabsList className="bg-white/5 border border-white/10">
                    <TabsTrigger value="members">Members ({members.length})</TabsTrigger>
                    <TabsTrigger value="permissions">Role Permissions</TabsTrigger>
                </TabsList>

                <TabsContent value="members" className="mt-4">
                    <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                        <Table>
                            <TableHeader className="border-white/10">
                                <TableRow className="border-white/10 hover:bg-white/5">
                                    <TableHead className="text-muted-foreground">Member</TableHead>
                                    <TableHead className="text-muted-foreground">Role</TableHead>
                                    <TableHead className="text-muted-foreground">Status</TableHead>
                                    <TableHead className="text-right text-muted-foreground">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {members.map((member) => (
                                    <TableRow key={member.id} className="border-white/10 hover:bg-white/5">
                                        <TableCell className="font-medium text-white">
                                            <div className="flex items-center gap-3">
                                                <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-muted-foreground">
                                                    {member.name.charAt(0)}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span>{member.name}</span>
                                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <Mail className="h-3 w-3" /> {member.email}
                                                    </span>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center text-sm text-gray-300 capitalize">
                                                {getRoleIcon(member.role)}
                                                {member.role}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={
                                                member.status === 'Active'
                                                    ? "border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/10"
                                                    : "border-yellow-500/20 text-yellow-500 hover:bg-yellow-500/10"
                                            }>
                                                {member.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-white">
                                                Manage
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Card>
                </TabsContent>

                <TabsContent value="permissions" className="mt-4">
                    <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Permission Matrix</CardTitle>
                                <CardDescription>
                                    {currentUserRole === 'owner'
                                        ? "Click cells to toggle access levels for each role."
                                        : "View-only access to role permissions."}
                                </CardDescription>
                            </div>
                            {currentUserRole === 'owner' && (
                                <Badge variant="outline" className="border-emerald-500/30 text-emerald-500 bg-emerald-500/10">
                                    Editing Enabled
                                </Badge>
                            )}
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader className="border-white/10">
                                    <TableRow className="border-white/10 hover:bg-white/5">
                                        <TableHead className="text-muted-foreground w-[200px]">Tool / Feature</TableHead>
                                        {ROLES.map(role => (
                                            <TableHead key={role} className="text-center text-muted-foreground capitalize">{role}</TableHead>
                                        ))}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {Object.values(TOOL_REGISTRY)
                                        .filter(tool => tool.tier !== 'free') // Filter out free tools
                                        .map((tool) => (
                                            <TableRow key={tool.id} className="border-white/10 hover:bg-white/5">
                                                <TableCell className="font-medium text-white">
                                                    <div className="flex items-center gap-2">
                                                        <tool.icon className="h-4 w-4 text-muted-foreground" />
                                                        {tool.label}
                                                    </div>
                                                </TableCell>
                                                {ROLES.map(role => {
                                                    const currentAllowed = permissions[tool.id] || []
                                                    const hasAccess = currentAllowed.includes(role)
                                                    const isExempt = role === 'owner'
                                                    const canEdit = currentUserRole === 'owner' && !isExempt

                                                    return (
                                                        <TableCell
                                                            key={role}
                                                            className={cn(
                                                                "text-center transition-colors",
                                                                canEdit ? "cursor-pointer hover:bg-white/10" : "cursor-default opacity-80"
                                                            )}
                                                            onClick={() => canEdit && handlePermissionToggle(tool.id, role)}
                                                        >
                                                            {hasAccess ? (
                                                                isExempt ? (
                                                                    <Lock className="h-3 w-3 text-emerald-500/50 mx-auto" />
                                                                ) : (
                                                                    <Check className="h-4 w-4 text-emerald-500 mx-auto" />
                                                                )
                                                            ) : (
                                                                <X className="h-4 w-4 text-white/10 mx-auto" />
                                                            )}
                                                        </TableCell>
                                                    )
                                                })}
                                            </TableRow>
                                        ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
