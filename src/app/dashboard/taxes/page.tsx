"use client"

import React, { useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Download, FileText, AlertCircle, ArrowUpRight, DollarSign, Calculator, Settings, Building2 } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"

import { useMockDatabase } from '@/lib/contexts/mock-db-context'
import { CRA_CATEGORIES, PROVINCIAL_RATES, generateT2125CSV, downloadCSV, extractTax } from '@/lib/utils/tax-exports'
import { RoleGuard } from '@/components/auth/role-guard'
import { useWorkspace } from '@/lib/contexts/workspace-context'

export default function TaxesPage() {
    return (
        <RoleGuard allowedRoles={['owner']}>
            <TaxesContent />
        </RoleGuard>
    )
}

function TaxesContent() {
    const { activeWorkspace } = useWorkspace()
    const { transactions: allTransactions } = useMockDatabase()

    // Filter by Workspace
    const transactions = useMemo(() =>
        allTransactions.filter(t => t.workspaceId === activeWorkspace.id),
        [allTransactions, activeWorkspace.id])

    const [province, setProvince] = useState<string>("ON")
    const [isSettingsOpen, setIsSettingsOpen] = useState(false)

    // Tax Config
    const taxInfo = PROVINCIAL_RATES[province]
    const currentYear = new Date().getFullYear()

    // --- Calculations ---

    // Total Effective Rate
    const totalRate = taxInfo.gst + taxInfo.pst + taxInfo.hst

    // 1. Revenue (Inc. Tax) -> Extract Tax Collected
    const totalIncome = transactions
        .filter(t => t.type === 'income')
        .reduce((acc, t) => acc + t.amount, 0)

    // Simplified: Assuming all income includes applicable taxes
    // Tax Collected = Total * (Rate / (1 + Rate))
    const taxCollected = totalIncome * (totalRate / (1 + totalRate))

    // Breakdown
    const gstCollected = totalIncome * (taxInfo.gst / (1 + totalRate))
    const pstCollected = totalIncome * (taxInfo.pst / (1 + totalRate))
    const hstCollected = totalIncome * (taxInfo.hst / (1 + totalRate))

    const netRevenue = totalIncome - taxCollected

    // 2. Expenses (Inc. Tax) -> Extract ITCs (Input Tax Credits)
    // Simplified: Assuming standard expenses have embedded tax
    // Note: PST is often NOT recoverable as an ITC, unlike GST/HST/QST.
    // For this mock, we will assume businesses can claim ITCs on GST/HST and QST, but maybe not PST?
    // Let's keep it simple: Total Tax Paid is calculated, but maybe separate "Recoverable" vs "Expense".
    // For now, let's treat it all as "Tax Paid" for the dashboard view.

    const totalExpenses = transactions
        .filter(t => t.type === 'expense')
        .reduce((acc, t) => acc + Math.abs(t.amount), 0)

    const taxPaid = totalExpenses * (totalRate / (1 + totalRate)) // ITC approximation
    const netExpenses = totalExpenses - taxPaid

    // 3. Tax Liability
    const netTaxOwl = taxCollected - taxPaid

    const deductions = transactions.filter(t => t.type === 'expense').map(t => {
        const cat = CRA_CATEGORIES[t.category] || CRA_CATEGORIES['Other']
        return {
            id: t.id,
            name: t.description,
            amount: Math.abs(t.amount),
            category: t.category,
            craLine: cat.code
        }
    })

    const handleDownloadReport = () => {
        const csv = generateT2125CSV(transactions, currentYear)
        downloadCSV(csv, `T2125_Worksheet_${currentYear}.csv`)
    }

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Tax Center ({taxInfo.type})</h2>
                    <p className="text-muted-foreground flex items-center gap-2">
                        {taxInfo.label} Compliance • Rate: {(totalRate * 100).toFixed(2)}%
                        <Badge variant="outline" className="text-[10px] py-0 h-5 border-white/20">
                            {taxInfo.type === 'HST' ? `HST ${(taxInfo.hst * 100)}%` :
                                taxInfo.type === 'GST+QST' ? `GST 5% + QST 9.975%` :
                                    `GST 5% ${taxInfo.pst > 0 ? `+ PST ${(taxInfo.pst * 100)}%` : ''}`}
                        </Badge>
                    </p>
                </div>
                <div className="flex gap-2">
                    <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" className="border-white/10 hover:bg-white/5">
                                <Settings className="h-4 w-4 mr-2" />
                                Settings
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-zinc-950 border-white/10 text-white">
                            <DialogHeader>
                                <DialogTitle>Regional Settings</DialogTitle>
                                <DialogDescription className="text-gray-400">
                                    Configure your tax jurisdiction.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="province" className="text-right">Province</Label>
                                    <Select value={province} onValueChange={setProvince}>
                                        <SelectTrigger className="col-span-3 bg-white/5 border-white/10 text-white">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="bg-zinc-900 border-white/10 text-white">
                                            {Object.entries(PROVINCIAL_RATES).map(([code, info]) => {
                                                const rate = info.gst + info.pst + info.hst
                                                return (
                                                    <SelectItem key={code} value={code}>
                                                        {info.label} ({(rate * 100).toFixed(rate % 1 === 0 ? 0 : 3)}%)
                                                    </SelectItem>
                                                )
                                            })}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>
                    <Button
                        className="gap-2 bg-primary hover:bg-primary/90 text-white"
                        onClick={handleDownloadReport}
                    >
                        <Download className="h-4 w-4" />
                        Download T2125 CSV
                    </Button>
                </div>
            </div>

            {/* Tax Overview Cards */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Net Tax Owing</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-white">
                            {netTaxOwl >= 0 ? `$${netTaxOwl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `($${Math.abs(netTaxOwl).toLocaleString(undefined, { minimumFractionDigits: 2 })})`}
                        </div>
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                            {netTaxOwl >= 0 ? "Remittance due to CRA/Revenu Québec" : "Refund due"}
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Tax Collected</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-400">
                            +${taxCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="flex flex-col gap-0.5 mt-2">
                            {taxInfo.gst > 0 && (
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>GST (5%)</span>
                                    <span>${gstCollected.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                </div>
                            )}
                            {taxInfo.pst > 0 && (
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>{taxInfo.type === 'GST+QST' ? 'QST' : 'PST'} ({(taxInfo.pst * 100).toFixed(3)}%)</span>
                                    <span>${pstCollected.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                </div>
                            )}
                            {taxInfo.hst > 0 && (
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>HST ({(taxInfo.hst * 100)}%)</span>
                                    <span>${hstCollected.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ITCs (Tax Paid)</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-400">
                            -${taxPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Estimated recoverable tax on expenses.
                        </p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="bg-black/40 border-white/10">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle>Deductible Expenses</CardTitle>
                            <CardDescription>Grouped by CRA Line Codes.</CardDescription>
                        </div>
                        <Building2 className="text-muted-foreground h-5 w-5" />
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                            {deductions.map((item) => (
                                <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-white/5 bg-white/5">
                                    <div className="flex items-center gap-3">
                                        <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                                            {item.craLine}
                                        </div>
                                        <div>
                                            <p className="font-medium text-sm text-white">{item.name}</p>
                                            <p className="text-xs text-muted-foreground">{item.category}</p>
                                        </div>
                                    </div>
                                    <span className="font-mono text-white text-sm">-${item.amount.toLocaleString()}</span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-black/40 border-white/10">
                    <CardHeader>
                        <CardTitle>Compliance Documents</CardTitle>
                        <CardDescription>Ready-to-file reports.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 border rounded-lg border-white/5 bg-white/5 hover:bg-white/10 transition-colors cursor-pointer" onClick={handleDownloadReport}>
                                <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                                        <FileText className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-white">T2125 Statement of Business Activities</p>
                                        <p className="text-xs text-muted-foreground">Detailed expense breakdown for {currentYear}</p>
                                    </div>
                                </div>
                                <Button variant="ghost" size="sm" className="hover:text-white">
                                    <Download className="h-4 w-4" />
                                </Button>
                            </div>

                            <div className="flex items-center justify-between p-4 border rounded-lg border-white/5 bg-white/5 hover:bg-white/10 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                                        <Calculator className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-white">{taxInfo.type} Return Worksheet</p>
                                        <p className="text-xs text-muted-foreground">Net Tax calculation for remittance</p>
                                    </div>
                                </div>
                                <Button variant="ghost" size="sm" className="hover:text-white">
                                    <Download className="h-4 w-4" />
                                </Button>
                            </div>

                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
