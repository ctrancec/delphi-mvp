"use client"

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus, CreditCard, Landmark, ArrowUpRight, TrendingUp } from 'lucide-react'
import { cn } from "@/lib/utils"
import { useMockDatabase } from '@/lib/contexts/mock-db-context'
import { useWorkspace } from '@/lib/contexts/workspace-context'
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { useState } from "react"

export default function AccountsPage() {
    const { activeWorkspace } = useWorkspace()
    const { accounts, addAccount } = useMockDatabase()
    const [isAddOpen, setIsAddOpen] = useState(false)
    const [newAccount, setNewAccount] = useState<{
        name: string
        institution: string
        type: 'checking' | 'savings' | 'credit' | 'investment' | 'cash'
        balance: string
        color: string
    }>({
        name: '',
        institution: '',
        type: 'checking',
        balance: '',
        color: 'from-blue-600 to-blue-400'
    })

    const handleAddAccount = async () => {
        if (!newAccount.name || !newAccount.institution) return
        await addAccount({
            workspaceId: activeWorkspace?.id || '',
            name: newAccount.name,
            institution: newAccount.institution,
            type: newAccount.type,
            balance: parseFloat(newAccount.balance) || 0,
            color: newAccount.color
        })
        setIsAddOpen(false)
        setNewAccount({ name: '', institution: '', type: 'checking', balance: '', color: 'from-blue-600 to-blue-400' })
    }

    // Filter accounts by active workspace
    const workspaceAccounts = accounts.filter(acc => acc.workspaceId === activeWorkspace.id)

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Accounts</h2>
                    <p className="text-muted-foreground">
                        Manage your connected bank accounts and cards.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                        <DialogTrigger asChild>
                            <Button className="bg-primary hover:bg-primary/90 text-white">
                                <Plus className="h-4 w-4 mr-2" />
                                Connect Account
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-zinc-950 border-white/10 text-white">
                            <DialogHeader>
                                <DialogTitle>Add Account</DialogTitle>
                                <DialogDescription className="text-gray-400">
                                    Manually add a bank account or credit card.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <Label>Account Name</Label>
                                    <Input
                                        value={newAccount.name}
                                        onChange={e => setNewAccount({ ...newAccount, name: e.target.value })}
                                        className="bg-white/5 border-white/10 text-white"
                                        placeholder="e.g. Main Checking"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Institution</Label>
                                    <Input
                                        value={newAccount.institution}
                                        onChange={e => setNewAccount({ ...newAccount, institution: e.target.value })}
                                        className="bg-white/5 border-white/10 text-white"
                                        placeholder="e.g. Chase, Bank of America"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                        <Label>Type</Label>
                                        <Select
                                            value={newAccount.type}
                                            onValueChange={val => setNewAccount({ ...newAccount, type: val as any })}
                                        >
                                            <SelectTrigger className="bg-white/5 border-white/10 text-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-zinc-950 border-white/10 text-white">
                                                <SelectItem value="checking">Checking</SelectItem>
                                                <SelectItem value="savings">Savings</SelectItem>
                                                <SelectItem value="credit">Credit Card</SelectItem>
                                                <SelectItem value="investment">Investment</SelectItem>
                                                <SelectItem value="cash">Cash</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>Initial Balance</Label>
                                        <Input
                                            type="number"
                                            value={newAccount.balance}
                                            onChange={e => setNewAccount({ ...newAccount, balance: e.target.value })}
                                            className="bg-white/5 border-white/10 text-white"
                                            placeholder="0.00"
                                        />
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleAddAccount} className="bg-emerald-600 hover:bg-emerald-500">
                                    Create Account
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {workspaceAccounts.length === 0 ? (
                    <Card className="col-span-full border-dashed border-white/10 bg-white/5 p-8 flex flex-col items-center justify-center text-center">
                        <div className="h-12 w-12 rounded-full bg-white/10 flex items-center justify-center mb-4">
                            <Landmark className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-medium text-white mb-1">No accounts connected</h3>
                        <p className="text-muted-foreground mb-4 max-w-sm">
                            Connect a bank account or credit card to start tracking your finances in this workspace.
                        </p>
                        <Button
                            onClick={() => setIsAddOpen(true)}
                            variant="outline"
                            className="border-white/10 text-white hover:bg-white/5"
                        >
                            Add Manual Account
                        </Button>
                    </Card>
                ) : (
                    workspaceAccounts.map(account => (
                        <Card key={account.id} className="relative overflow-hidden border-white/10 bg-white/5 transition-all hover:bg-white/10 group">
                            <div className={cn("absolute inset-0 opacity-0 group-hover:opacity-10 bg-gradient-to-br transition-opacity", account.color)} />

                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <div className="space-y-1">
                                    <CardTitle className="text-lg font-medium">{account.name}</CardTitle>
                                    <CardDescription className="flex items-center gap-1">
                                        {account.institution}
                                    </CardDescription>
                                </div>
                                <div className={cn("p-2 rounded-full bg-gradient-to-br opacity-80", account.color)}>
                                    {account.type === 'credit' ? <CreditCard className="h-5 w-5 text-white" /> : <Landmark className="h-5 w-5 text-white" />}
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-white mb-1">
                                    {account.type === 'credit' ? '-' : ''}${Math.abs(account.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground capitalize">{account.type}</span>
                                    {/* Change logic would need historical data, omitting for now */}
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}

                {/* Always show Add New Placeholder if there are accounts, or maybe just leave it out if we have the empty state? 
                    Let's keep it if there are accounts so they can add more.
                */}
                {workspaceAccounts.length > 0 && (
                    <Card
                        className="flex flex-col items-center justify-center border-dashed border-white/20 bg-transparent hover:bg-white/5 cursor-pointer h-full min-h-[160px]"
                        onClick={() => setIsAddOpen(true)}
                    >
                        <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center mb-4">
                            <Plus className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <div className="font-medium text-muted-foreground">Add New Account</div>
                    </Card>
                )}
            </div>

            {/* Recent Activity Section - We could make this real too, but let's stick to the main request first or filter transactions by account */}
            <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                <CardHeader>
                    <CardTitle>Recent Synced Activity</CardTitle>
                    <CardDescription>Latest transactions from all connected accounts.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="p-4 text-center text-muted-foreground text-sm">
                        Recent activity will appear here once transactions are linked to accounts.
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
