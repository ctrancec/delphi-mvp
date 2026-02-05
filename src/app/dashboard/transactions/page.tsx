
"use client"

import React, { useState } from 'react'
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Search,
    Download,
    Plus,
    Filter,
    Calculator,
    Save,
    MoreHorizontal
} from 'lucide-react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useWorkspace } from '@/lib/contexts/workspace-context'
import { useMockDatabase } from '@/lib/contexts/mock-db-context'
import { cn } from "@/lib/utils"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

export default function TransactionsPage() {
    const { activeWorkspace } = useWorkspace()
    const { transactions, accounts, addTransaction } = useMockDatabase()

    // Filter transactions by workspace
    const rows = React.useMemo(() => {
        return transactions.filter(t => t.workspaceId === activeWorkspace.id)
    }, [transactions, activeWorkspace.id])

    // Account Lookup Map
    const accountMap = React.useMemo(() => {
        return accounts.reduce((acc, account) => {
            acc[account.id] = account.name
            return acc
        }, {} as Record<string, string>)
    }, [accounts])

    const [selectedCell, setSelectedCell] = useState<{ row: string, col: string } | null>(null)
    const [formulaValue, setFormulaValue] = useState("")
    const [viewMode, setViewMode] = useState<'simple' | 'advanced'>('advanced')

    // Add Transaction State
    const [showAddTx, setShowAddTx] = useState(false)
    const [newTx, setNewTx] = useState({ description: '', amount: '', category: 'General', type: 'expense', accountId: '' })
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Filter accounts by workspace
    const workspaceAccounts = accounts.filter(a => a.workspaceId === activeWorkspace.id)

    const handleSelect = (rowId: string, field: string, value: any) => {
        setSelectedCell({ row: rowId, col: field })
        setFormulaValue(value ? value.toString() : '')
    }

    // Note: Editing is not fully implemented in this view for the mock DB context yet
    const handleChange = (id: string, field: string, value: string) => {
        console.log("Edit attempted", id, field, value)
    }

    const handleAddTransaction = async () => {
        if (!newTx.description || !newTx.amount) return
        setIsSubmitting(true)
        try {
            await addTransaction({
                workspaceId: activeWorkspace.id,
                description: newTx.description,
                amount: parseFloat(newTx.amount),
                category: newTx.category,
                type: newTx.type as 'income' | 'expense',
                status: 'completed',
                payee: newTx.description, // Fallback payee
                accountId: newTx.accountId || undefined
            })
            setShowAddTx(false)
            setNewTx({ description: '', amount: '', category: 'General', type: 'expense', accountId: '' })
        } catch (e) {
            console.error("Failed to add tx", e)
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="space-y-6 h-[calc(100vh-6rem)] flex flex-col">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Transactions</h2>
                    <p className="text-muted-foreground">
                        {viewMode === 'simple' ? 'Simplified overview of expenses.' : 'Spreadsheet view for advanced financial management.'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="bg-white/5 border border-white/10 rounded-lg p-1 mr-4 flex items-center">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn("h-7 px-3 text-xs", viewMode === 'simple' && "bg-white/10 text-white")}
                            onClick={() => setViewMode('simple')}
                        >
                            Simple
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn("h-7 px-3 text-xs", viewMode === 'advanced' && "bg-white/10 text-white")}
                            onClick={() => setViewMode('advanced')}
                        >
                            Advanced
                        </Button>
                    </div>
                    {viewMode === 'advanced' && (
                        <Button variant="outline" className="border-white/10 text-muted-foreground hover:text-white hover:bg-white/5">
                            <Save className="h-4 w-4 mr-2" />
                            Save
                        </Button>
                    )}

                    {/* Add Transaction Dialog */}
                    <Dialog open={showAddTx} onOpenChange={setShowAddTx}>
                        <DialogTrigger asChild>
                            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
                                <Plus className="h-4 w-4 mr-2" />
                                Add Transaction
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-zinc-950 border-white/10 text-white">
                            <DialogHeader>
                                <DialogTitle>Add Transaction</DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <Label>Description / Payee</Label>
                                    <Input
                                        value={newTx.description}
                                        onChange={e => setNewTx({ ...newTx, description: e.target.value })}
                                        className="bg-white/5 border-white/10"
                                        placeholder="e.g. Starbucks, Client Payment"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Amount (+ for Income, - for Expense)</Label>
                                    <Input
                                        type="number"
                                        value={newTx.amount}
                                        onChange={e => setNewTx({ ...newTx, amount: e.target.value })}
                                        className="bg-white/5 border-white/10"
                                        placeholder="-50.00"
                                    />
                                    <p className="text-xs text-muted-foreground">Use negative value for expenses (e.g. -15.00)</p>
                                </div>
                                <div className="grid gap-2">
                                    <Label>Category</Label>
                                    <Input
                                        value={newTx.category}
                                        onChange={e => setNewTx({ ...newTx, category: e.target.value })}
                                        className="bg-white/5 border-white/10"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Account (Optional)</Label>
                                    <Select
                                        value={newTx.accountId}
                                        onValueChange={(val) => setNewTx({ ...newTx, accountId: val })}
                                    >
                                        <SelectTrigger className="bg-white/5 border-white/10">
                                            <SelectValue placeholder="Select Account" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {workspaceAccounts.map(acc => (
                                                <SelectItem key={acc.id} value={acc.id}>
                                                    {acc.name} ({acc.institution})
                                                </SelectItem>
                                            ))}
                                            {workspaceAccounts.length === 0 && (
                                                <div className="p-2 text-xs text-muted-foreground text-center">
                                                    No accounts found. Go to "Accounts" to add one.
                                                </div>
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="ghost" onClick={() => setShowAddTx(false)}>Cancel</Button>
                                <Button onClick={handleAddTransaction} disabled={isSubmitting} className="bg-emerald-600 hover:bg-emerald-500">
                                    {isSubmitting ? 'Adding...' : 'Add Transaction'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <Button variant="outline" className="border-white/10 text-muted-foreground hover:text-white">
                        <Download className="h-4 w-4 mr-2" />
                        Export
                    </Button>
                </div>
            </div>

            {viewMode === 'simple' ? (
                /* Simplified List View */
                <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                    <div className="p-4 border-b border-white/10 flex items-center gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Search transactions..." className="pl-9 bg-white/5 border-white/10" />
                        </div>
                        <Button variant="outline" className="border-white/10">Filter</Button>
                    </div>
                    <div className="relative w-full overflow-auto">
                        <table className="w-full caption-bottom text-sm text-left">
                            <thead className="[&_tr]:border-b [&_tr]:border-white/10">
                                <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                                    <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Date</th>
                                    <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Description</th>
                                    <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Account</th>
                                    <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Category</th>
                                    <th className="h-12 px-4 align-middle font-medium text-muted-foreground text-right">Amount</th>
                                    <th className="h-12 px-4 align-middle font-medium text-muted-foreground text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody className="[&_tr:last-child]:border-0">
                                {rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="p-8 text-center text-muted-foreground">No transactions found for this workspace.</td>
                                    </tr>
                                ) : rows.map((row) => (
                                    <tr key={row.id} className="border-b border-white/5 transition-colors hover:bg-white/5">
                                        <td className="p-4 align-middle text-muted-foreground">{new Date(row.date).toLocaleDateString()}</td>
                                        <td className="p-4 align-middle font-medium text-white">{row.description}</td>
                                        <td className="p-4 align-middle text-muted-foreground">
                                            {row.accountId ? accountMap[row.accountId] || 'Unknown' : '-'}
                                        </td>
                                        <td className="p-4 align-middle">
                                            <span className="inline-flex items-center rounded-md bg-white/10 px-2 py-1 text-xs font-medium text-white ring-1 ring-inset ring-white/20">
                                                {row.category}
                                            </span>
                                        </td>
                                        <td className={cn("p-4 align-middle text-right font-mono", row.amount > 0 ? "text-emerald-500" : "text-white")}>
                                            {typeof row.amount === 'number' ? row.amount.toFixed(2) : row.amount}
                                        </td>
                                        <td className="p-4 align-middle text-right">
                                            <span className={cn("text-xs px-2 py-0.5 rounded-full border", row.status === 'completed' || row.status === 'posted' ? "border-emerald-500/20 text-emerald-500" : "border-yellow-500/20 text-yellow-500")}>
                                                {row.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            ) : (
                /* Advanced Excel View */
                <Card className="bg-black/40 border-white/10 backdrop-blur-xl flex flex-col flex-1">
                    <div className="p-2 border-b border-white/10 flex items-center gap-2 bg-white/5">
                        <div className="flex items-center border-r border-white/10 pr-2 mr-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8"><Plus className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><Filter className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><Calculator className="h-4 w-4" /></Button>
                        </div>
                        <div className="flex-1 flex items-center gap-2 bg-black/60 rounded border border-white/10 px-2 h-9">
                            <span className="text-xs text-muted-foreground font-mono w-16 border-r border-white/10 pr-2">
                                {selectedCell ? `${selectedCell.col.toUpperCase()}${selectedCell.row}` : ''}
                            </span>
                            <span className="text-muted-foreground text-xs italic">fx</span>
                            <Input
                                className="h-7 border-0 bg-transparent focus-visible:ring-0 p-0 text-sm font-mono"
                                value={formulaValue}
                                onChange={(e) => setFormulaValue(e.target.value)}
                                placeholder="Select a cell..."
                            />
                        </div>
                    </div>

                    {/* Updated grid cols to include Account column */}
                    <div className="grid grid-cols-[50px_1fr_2fr_1fr_1fr_1fr_1fr_50px] bg-white/5 border-b border-white/10 font-medium text-xs text-muted-foreground divide-x divide-white/10">
                        <div className="h-8 flex items-center justify-center bg-white/5">#</div>
                        <div className="h-8 flex items-center px-4">A <span className="ml-2 opacity-50 font-normal">Date</span></div>
                        <div className="h-8 flex items-center px-4">B <span className="ml-2 opacity-50 font-normal">Description</span></div>
                        <div className="h-8 flex items-center px-4">C <span className="ml-2 opacity-50 font-normal">Account</span></div>
                        <div className="h-8 flex items-center px-4">D <span className="ml-2 opacity-50 font-normal">Category</span></div>
                        <div className="h-8 flex items-center px-4">E <span className="ml-2 opacity-50 font-normal">Amount</span></div>
                        <div className="h-8 flex items-center px-4">F <span className="ml-2 opacity-50 font-normal">Status</span></div>
                        <div className="h-8 flex items-center justify-center">...</div>
                    </div>

                    <div className="flex-1 overflow-auto">
                        {rows.map((row, i) => (
                            <div key={row.id} className="grid grid-cols-[50px_1fr_2fr_1fr_1fr_1fr_1fr_50px] border-b border-white/5 text-sm divide-x divide-white/5 hover:bg-white/[0.02]">
                                <div className="flex items-center justify-center text-xs text-muted-foreground bg-white/5 select-none font-mono">{i + 1}</div>

                                <div className={cn("p-0.5", selectedCell?.row === row.id && selectedCell.col === 'date' && "ring-1 ring-primary inset-0 z-10")}>
                                    <input className="w-full h-full bg-transparent px-3 py-2 focus:outline-none text-gray-300 placeholder:text-gray-600" value={new Date(row.date).toLocaleDateString()} readOnly onClick={() => handleSelect(row.id, 'date', row.date)} />
                                </div>
                                <div className={cn("p-0.5", selectedCell?.row === row.id && selectedCell.col === 'desc' && "ring-1 ring-primary inset-0 z-10")}>
                                    <input className="w-full h-full bg-transparent px-3 py-2 focus:outline-none text-white font-medium" value={row.description} readOnly onClick={() => handleSelect(row.id, 'desc', row.description)} />
                                </div>
                                {/* Account Column */}
                                <div className={cn("p-0.5", selectedCell?.row === row.id && selectedCell.col === 'account' && "ring-1 ring-primary inset-0 z-10")}>
                                    <input className="w-full h-full bg-transparent px-3 py-2 focus:outline-none text-gray-400" value={row.accountId ? accountMap[row.accountId] || '' : ''} readOnly onClick={() => handleSelect(row.id, 'account', row.accountId ? accountMap[row.accountId] : '')} />
                                </div>
                                <div className={cn("p-0.5", selectedCell?.row === row.id && selectedCell.col === 'category' && "ring-1 ring-primary inset-0 z-10")}>
                                    <input className="w-full h-full bg-transparent px-3 py-2 focus:outline-none text-gray-400" value={row.category} readOnly onClick={() => handleSelect(row.id, 'category', row.category)} />
                                </div>
                                <div className={cn("p-0.5", selectedCell?.row === row.id && selectedCell.col === 'amount' && "ring-1 ring-primary inset-0 z-10")}>
                                    <input className={cn("w-full h-full bg-transparent px-3 py-2 focus:outline-none text-right font-mono", row.amount > 0 ? "text-emerald-500" : "text-white")} value={row.amount} readOnly onClick={() => handleSelect(row.id, 'amount', row.amount)} />
                                </div>
                                <div className={cn("p-0.5", selectedCell?.row === row.id && selectedCell.col === 'status' && "ring-1 ring-primary inset-0 z-10")}>
                                    <input className="w-full h-full bg-transparent px-3 py-2 focus:outline-none text-gray-400" value={row.status} readOnly onClick={() => handleSelect(row.id, 'status', row.status)} />
                                </div>

                                <div className="flex items-center justify-center text-muted-foreground hover:text-white cursor-pointer">
                                    <MoreHorizontal className="h-4 w-4" />
                                </div>
                            </div>
                        ))}
                        {/* Empty Rows */}
                        {Array.from({ length: Math.max(0, 15 - rows.length) }).map((_, i) => (
                            <div key={`empty-${i}`} className="grid grid-cols-[50px_1fr_2fr_1fr_1fr_1fr_1fr_50px] border-b border-white/5 text-sm divide-x divide-white/5">
                                <div className="flex items-center justify-center text-xs text-muted-foreground bg-white/5 select-none font-mono">{rows.length + i + 1}</div>
                                <div className="p-0.5 h-8"></div><div className="p-0.5 h-8"></div><div className="p-0.5 h-8"></div><div className="p-0.5 h-8"></div><div className="p-0.5 h-8"></div><div className="p-0.5 h-8"></div><div className="p-0.5 h-8"></div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    )
}
