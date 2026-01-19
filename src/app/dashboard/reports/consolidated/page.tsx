"use client"

import React, { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useMockDatabase } from '@/lib/contexts/mock-db-context'
import { RoleGuard } from '@/components/auth/role-guard'
import {
    TrendingUp,
    TrendingDown,
    DollarSign,
    PieChart,
    ArrowUpRight,
    Building2
} from 'lucide-react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

const WORKSPACE_NAMES: Record<string, string> = {
    'ws-personal': 'Personal',
    'ws-deli': 'Deli & Cafe',
    'ws-consulting': 'Consulting'
}

export default function ConsolidatedReportingPage() {
    const { transactions } = useMockDatabase()

    const reportData = useMemo(() => {
        const workspaceStats: Record<string, { revenue: number, expenses: number, net: number }> = {}
        let totalRevenue = 0
        let totalExpenses = 0

        transactions.forEach(t => {
            const wsId = t.workspaceId
            if (!workspaceStats[wsId]) {
                workspaceStats[wsId] = { revenue: 0, expenses: 0, net: 0 }
            }

            if (t.type === 'income') {
                workspaceStats[wsId].revenue += t.amount
                totalRevenue += t.amount
            } else {
                workspaceStats[wsId].expenses += Math.abs(t.amount)
                totalExpenses += Math.abs(t.amount)
            }
        })

        // Calculate Net for each
        Object.keys(workspaceStats).forEach(wsId => {
            workspaceStats[wsId].net = workspaceStats[wsId].revenue - workspaceStats[wsId].expenses
        })

        return {
            workspaceStats,
            totalRevenue,
            totalExpenses,
            netProfit: totalRevenue - totalExpenses
        }
    }, [transactions])

    return (
        <RoleGuard allowedRoles={['owner']}>
            <div className="space-y-8">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Consolidated Reporting</h2>
                    <p className="text-muted-foreground">
                        Aggregated financial performance across all workspaces.
                    </p>
                </div>

                {/* Summary Cards */}
                <div className="grid gap-4 md:grid-cols-3">
                    <Card className="bg-emerald-950/20 border-emerald-900/50">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-emerald-400">Total Revenue</CardTitle>
                            <TrendingUp className="h-4 w-4 text-emerald-400" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-white">${reportData.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                            <p className="text-xs text-emerald-500/70">+12% from last month</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-rose-950/20 border-rose-900/50">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-rose-400">Total Expenses</CardTitle>
                            <TrendingDown className="h-4 w-4 text-rose-400" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-white">${reportData.totalExpenses.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                            <p className="text-xs text-rose-500/70">+4% from last month</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-indigo-950/20 border-indigo-900/50">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-indigo-400">Net Profit</CardTitle>
                            <DollarSign className="h-4 w-4 text-indigo-400" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-white">${reportData.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                            <p className="text-xs text-indigo-400/70">Healthy margin of {((reportData.netProfit / reportData.totalRevenue) * 100).toFixed(1)}%</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Breakdown Table */}
                <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Building2 className="h-5 w-5 text-primary" />
                            Workspace Breakdown
                        </CardTitle>
                        <CardDescription>
                            Financial contribution by business unit.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow className="border-white/10 hover:bg-white/5">
                                    <TableHead className="text-white">Workspace</TableHead>
                                    <TableHead className="text-right text-emerald-400">Revenue</TableHead>
                                    <TableHead className="text-right text-rose-400">Expenses</TableHead>
                                    <TableHead className="text-right text-indigo-400">Net Profit</TableHead>
                                    <TableHead className="text-right text-muted-foreground">% Contribution</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {Object.entries(reportData.workspaceStats).map(([id, stats]) => (
                                    <TableRow key={id} className="border-white/5 hover:bg-white/5">
                                        <TableCell className="font-medium text-white">
                                            {WORKSPACE_NAMES[id] || id}
                                        </TableCell>
                                        <TableCell className="text-right text-emerald-500 font-mono">
                                            ${stats.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </TableCell>
                                        <TableCell className="text-right text-rose-500 font-mono">
                                            ${stats.expenses.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-white">
                                            ${stats.net.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground">
                                            {reportData.totalRevenue > 0
                                                ? ((stats.revenue / reportData.totalRevenue) * 100).toFixed(1)
                                                : 0}%
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </RoleGuard>
    )
}
