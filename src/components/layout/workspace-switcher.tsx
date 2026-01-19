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
import { useWorkspace } from "@/lib/contexts/workspace-context"
import { CreateWorkspaceDialog } from "./create-workspace-dialog"

export function WorkspaceSwitcher() {
    const { activeWorkspace, workspaces, switchWorkspace } = useWorkspace()
    const [open, setOpen] = React.useState(false)
    const [showNewWorkspaceDialog, setShowNewWorkspaceDialog] = React.useState(false)

    return (
        <>
            <CreateWorkspaceDialog
                open={showNewWorkspaceDialog}
                onOpenChange={setShowNewWorkspaceDialog}
            />

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
                                <span className="flex-1 truncate">{workspace.name}</span>
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
        </>
    )
}
