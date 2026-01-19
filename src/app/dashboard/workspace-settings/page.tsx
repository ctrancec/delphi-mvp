"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/ui-alert'
import { AlertCircle, Trash2, Save, ArrowLeft } from 'lucide-react'
import { useWorkspace } from '@/lib/contexts/workspace-context'
import { RoleGuard } from '@/components/auth/role-guard'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"

export default function WorkspaceSettingsPage() {
    return (
        <RoleGuard allowedRoles={['owner']}>
            <SettingsContent />
        </RoleGuard>
    )
}

function SettingsContent() {
    const { activeWorkspace, updateWorkspace, deleteWorkspace, isLoading } = useWorkspace()
    const router = useRouter()

    // Form States
    const [name, setName] = useState(activeWorkspace.name)
    const [isSaving, setIsSaving] = useState(false)

    // Delete States
    const [deleteConfirmInfo, setDeleteConfirmInfo] = useState("")
    const [isDeleting, setIsDeleting] = useState(false)
    const [openDeleteDialog, setOpenDeleteDialog] = useState(false)

    const handleSave = async () => {
        setIsSaving(true)
        try {
            await updateWorkspace(activeWorkspace.id, { name })
            // Optional: Success Toast
        } catch (e) {
            console.error(e)
            alert("Failed to update workspace")
        } finally {
            setIsSaving(false)
        }
    }

    const handleDelete = async () => {
        if (deleteConfirmInfo !== activeWorkspace.name) return

        setIsDeleting(true)
        try {
            await deleteWorkspace(activeWorkspace.id)
            router.push('/dashboard') // Redirect handled in context mostly, but safety check
        } catch (e: any) {
            console.error(e)
            alert(`Failed to delete workspace: ${e.message}`)
            setIsDeleting(false)
        }
    }

    if (isLoading) return <div className="p-8 text-white">Loading...</div>

    return (
        <div className="space-y-8 max-w-4xl mx-auto p-6 text-white pb-20">
            <div>
                <h1 className="text-3xl font-bold tracking-tight mb-2">Workspace Settings</h1>
                <p className="text-muted-foreground">
                    Manage your workspace preferences and danger zone.
                </p>
            </div>

            {/* General Settings */}
            <Card className="bg-black/40 border-white/10 text-white">
                <CardHeader>
                    <CardTitle>General Information</CardTitle>
                    <CardDescription>Update your workspace details.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-2">
                        <Label htmlFor="ws-name">Workspace Name</Label>
                        <Input
                            id="ws-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="bg-white/5 border-white/10"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>Workspace ID</Label>
                        <div className="p-2 rounded bg-white/5 border border-white/5 text-sm font-mono text-muted-foreground">
                            {activeWorkspace.id}
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="border-t border-white/10 pt-4 flex justify-between">
                    <span className="text-xs text-muted-foreground">Role: {activeWorkspace.role}</span>
                    <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 hover:bg-blue-500">
                        {isSaving ? <span className="animate-spin mr-2">⏳</span> : <Save className="mr-2 h-4 w-4" />}
                        Save Changes
                    </Button>
                </CardFooter>
            </Card>

            {/* Danger Zone */}
            <Card className="bg-red-950/10 border-red-500/20 text-white">
                <CardHeader>
                    <div className="flex items-center gap-2 text-red-400">
                        <AlertCircle className="h-5 w-5" />
                        <CardTitle className="text-red-400">Danger Zone</CardTitle>
                    </div>
                    <CardDescription className="text-red-400/70">
                        Irreversible actions. Tread carefully.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 border border-red-500/20 rounded-lg bg-red-950/20">
                        <div>
                            <h4 className="font-semibold text-red-200">Delete Workspace</h4>
                            <p className="text-sm text-red-300/70">
                                Permanently delete this workspace and all associated data (transactions, inventory, etc).
                            </p>
                        </div>

                        <Dialog open={openDeleteDialog} onOpenChange={setOpenDeleteDialog}>
                            <DialogTrigger asChild>
                                <Button variant="destructive" className="bg-red-600 hover:bg-red-700">
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete Workspace
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="bg-zinc-950 border-red-500/20 text-white">
                                <DialogHeader>
                                    <DialogTitle className="text-red-500">Delete Workspace?</DialogTitle>
                                    <DialogDescription className="text-zinc-400">
                                        This action cannot be undone. This will permanently delete the
                                        <span className="font-bold text-white px-1"> {activeWorkspace.name} </span>
                                        workspace and remove all collaborator access.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="space-y-4 py-4">
                                    <div className="space-y-2">
                                        <Label>Type the workspace name to confirm</Label>
                                        <Input
                                            value={deleteConfirmInfo}
                                            onChange={(e) => setDeleteConfirmInfo(e.target.value)}
                                            placeholder={activeWorkspace.name}
                                            className="bg-black border-red-500/30 ring-offset-red-900"
                                        />
                                    </div>

                                    {/* Warnings */}
                                    <Alert variant="destructive" className="bg-red-950/50 border-red-900">
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertTitle>Warning</AlertTitle>
                                        <AlertDescription>
                                            All data will be lost immediately.
                                        </AlertDescription>
                                    </Alert>
                                </div>

                                <DialogFooter>
                                    <Button variant="ghost" onClick={() => setOpenDeleteDialog(false)}>Cancel</Button>
                                    <Button
                                        variant="destructive"
                                        onClick={handleDelete}
                                        disabled={deleteConfirmInfo !== activeWorkspace.name || isDeleting}
                                        className="bg-red-600 hover:bg-red-700"
                                    >
                                        {isDeleting ? "Deleting..." : "Confirm Delete"}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
