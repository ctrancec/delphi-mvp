"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWorkspace } from "@/lib/contexts/workspace-context"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

interface CreateWorkspaceDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function CreateWorkspaceDialog({ open, onOpenChange }: CreateWorkspaceDialogProps) {
    const { addWorkspace, features, userSubscriptionTier } = useWorkspace()
    const [name, setName] = React.useState("")
    const [type, setType] = React.useState<string>("personal")
    // If not personal, store the specific business sub-type here
    const [businessSubType, setBusinessSubType] = React.useState<string>("business")

    const [isSubmitting, setIsSubmitting] = React.useState(false)

    // Reset state when dialog opens
    React.useEffect(() => {
        if (open) {
            setName("")
            setType("personal")
            setBusinessSubType("business")
            setIsSubmitting(false)
        }
    }, [open])

    const handleCreate = async () => {
        if (!name) return
        setIsSubmitting(true)

        try {
            // If type is personal, use 'personal'. 
            // If type is business, use the selected sub-type (e.g. 'restaurant')
            const finalType = type === 'personal' ? 'personal' : businessSubType

            await addWorkspace(name, finalType as any)
            onOpenChange(false)
        } catch (error) {
            console.error(error)
            alert("Failed to create workspace")
        } finally {
            setIsSubmitting(false)
        }
    }

    const canCreateBusiness = features?.canCreateBusiness || features?.canCreateFreelance

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px] bg-black/95 border-white/10 text-white">
                <DialogHeader>
                    <DialogTitle>Create Workspace</DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        Add a new workspace to manage a separate business entity.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">Workspace Name</Label>
                        <Input
                            id="name"
                            placeholder="e.g. Acme Corp"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="bg-zinc-900 border-white/10"
                        />
                    </div>

                    <div className="grid gap-3">
                        <Label>Usage Type</Label>
                        <div className="grid grid-cols-2 gap-4">
                            {/* Personal Card */}
                            <div
                                onClick={() => setType("personal")}
                                className={`cursor-pointer rounded-lg border p-4 hover:border-white/50 transition-all ${type === 'personal'
                                        ? 'bg-blue-600/20 border-blue-500 ring-1 ring-blue-500'
                                        : 'bg-zinc-900 border-white/10 hover:bg-white/5'
                                    }`}
                            >
                                <div className="font-semibold mb-1">Personal</div>
                                <div className="text-xs text-muted-foreground">For personal finance and budgeting</div>
                            </div>

                            {/* Business Card - Gated */}
                            <div
                                onClick={() => {
                                    if (canCreateBusiness) {
                                        setType("business")
                                    }
                                }}
                                className={`relative rounded-lg border p-4 transition-all ${!canCreateBusiness
                                        ? 'opacity-50 cursor-not-allowed bg-zinc-900/50 border-white/5'
                                        : type !== 'personal'
                                            ? 'bg-blue-600/20 border-blue-500 ring-1 ring-blue-500 cursor-pointer'
                                            : 'bg-zinc-900 border-white/10 hover:bg-white/5 hover:border-white/50 cursor-pointer'
                                    }`}
                            >
                                <div className="font-semibold mb-1">Business</div>
                                <div className="text-xs text-muted-foreground">For companies and freelancers</div>

                                {!canCreateBusiness && (
                                    <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-medium text-zinc-400 border border-white/10">
                                        PRO
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Conditional Industry Select for Business */}
                    {type !== 'personal' && (
                        <div className="grid gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
                            <Label>Business Category</Label>
                            <Select value={businessSubType} onValueChange={setBusinessSubType}>
                                <SelectTrigger className="bg-zinc-900 border-white/10">
                                    <SelectValue placeholder="Select industry" />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-950 border-white/10 text-white z-[9999]">
                                    {features?.canCreateBusiness && (
                                        <>
                                            <SelectItem value="business">Generic Business</SelectItem>
                                            <SelectItem value="retail">Retail Store</SelectItem>
                                            <SelectItem value="restaurant">Restaurant / Cafe</SelectItem>
                                        </>
                                    )}
                                    {features?.canCreateFreelance && (
                                        <SelectItem value="freelance">Freelance / Service</SelectItem>
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {/* Debug Plan Indicator */}
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                            Current Plan: <span className={userSubscriptionTier === 'free' ? 'text-zinc-400' : 'text-emerald-400'}>{userSubscriptionTier}</span>
                        </span>
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        className="border-white/10 hover:bg-white/5"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleCreate}
                        disabled={isSubmitting || !name}
                        className="bg-primary text-white hover:bg-primary/90"
                    >
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Create Workspace
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
