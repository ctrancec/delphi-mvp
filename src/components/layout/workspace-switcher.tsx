"use client"

import * as React from "react"
import { Check, ChevronsUpDown, PlusCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWorkspace } from "@/lib/contexts/workspace-context"

export function WorkspaceSwitcher() {
    const { activeWorkspace, workspaces, switchWorkspace, addWorkspace } = useWorkspace()
    const [open, setOpen] = React.useState(false)
    const [showNewWorkspaceDialog, setShowNewWorkspaceDialog] = React.useState(false)
    const [newWorkspaceName, setNewWorkspaceName] = React.useState("")

    const handleCreateWorkspace = () => {
        if (!newWorkspaceName) return

        const newWorkspace: any = {
            id: `ws-${Math.random().toString(36).substr(2, 9)}`,
            name: newWorkspaceName,
            type: 'business',
            tier: 'free', // Default to free for new ones
            enabledTools: ['overview', 'team', 'settings'], // Minimal set
            icon: Check // Default icon holder
        }

        addWorkspace(newWorkspace)
        switchWorkspace(newWorkspace.id)
        setShowNewWorkspaceDialog(false)
        setNewWorkspaceName("")
        setOpen(false)
    }

    return (
        <Dialog open={showNewWorkspaceDialog} onOpenChange={setShowNewWorkspaceDialog}>
            <DropdownMenu open={open} onOpenChange={setOpen}>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className="w-full justify-between bg-white/5 border-white/10 hover:bg-white/10 hover:text-white mb-2"
                    >
                        <span className="flex items-center gap-2 truncate">
                            <activeWorkspace.icon className="h-4 w-4 shrink-0 opacity-70" />
                            {activeWorkspace.name}
                        </span>
                        <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[200px] p-0 bg-black/90 border-white/10 backdrop-blur-xl text-white">
                    <DropdownMenuGroup>
                        <DropdownMenuLabel className="text-xs text-muted-foreground px-2 py-1.5 font-normal">
                            My Workspaces
                        </DropdownMenuLabel>
                        {workspaces.map((workspace) => (
                            <DropdownMenuItem
                                key={workspace.id}
                                onSelect={() => {
                                    switchWorkspace(workspace.id)
                                    setOpen(false)
                                }}
                                className="text-sm cursor-pointer focus:bg-white/10 focus:text-white"
                            >
                                <workspace.icon className="mr-2 h-4 w-4 opacity-70" />
                                {workspace.name}
                                <Check
                                    className={cn(
                                        "ml-auto h-4 w-4",
                                        activeWorkspace.id === workspace.id
                                            ? "opacity-100"
                                            : "opacity-0"
                                    )}
                                />
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator className="bg-white/10" />
                    <DropdownMenuItem
                        className="cursor-pointer focus:bg-white/10 focus:text-white"
                        onSelect={(e) => {
                            e.preventDefault()
                            setShowNewWorkspaceDialog(true)
                        }}
                    >
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Create Workspace
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <DialogContent className="sm:max-w-[425px] bg-black/95 border-white/10 text-white">
                <DialogHeader>
                    <DialogTitle>Create Workspace</DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        Add a new workspace to manage a separate business entity.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">Workspace Name</Label>
                        <Input
                            id="name"
                            placeholder="e.g. Acme Corp"
                            value={newWorkspaceName}
                            onChange={(e) => setNewWorkspaceName(e.target.value)}
                            className="bg-white/5 border-white/10"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setShowNewWorkspaceDialog(false)} className="border-white/10 hover:bg-white/5">Cancel</Button>
                    <Button onClick={handleCreateWorkspace} className="bg-primary text-white hover:bg-primary/90">Create Workspace</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
