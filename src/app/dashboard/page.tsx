"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    ArrowUpRight,
    ArrowDownRight,
    DollarSign,
    CreditCard,
    Activity,
    Plus,
    FileText,
    UtensilsCrossed,
    Clock,
    Truck,
    AlertCircle,
    Users,
    Package
} from 'lucide-react'
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/lib/contexts/workspace-context"
import Link from "next/link"

import { createClient } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'
import { format } from 'date-fns'

export default function DashboardPage() {
    const { activeWorkspace } = useWorkspace()
    const tools = activeWorkspace?.enabledTools || [] // Safe access
    const [recentActivity, setRecentActivity] = useState<any[]>([])
    const [stats, setStats] = useState({
        totalRevenue: 0,
        txCount: 0
    })

    // Fetch Real Data
    useEffect(() => {
        const fetchData = async () => {
            if (!activeWorkspace?.id) return

            const supabase = createClient()
            if (!supabase) return

            // 1. Fetch Transactions for Activity Feed & Sales Stats
            const { data: txs, error } = await supabase
                .from('transactions')
                .select('*')
                .eq('workspace_id', activeWorkspace.id)
                .order('date', { ascending: false })
                .limit(10)

            if (txs) {
                setRecentActivity(txs)

                // Calculate simple stats
                const total = txs
                    .filter(t => t.type === 'income')
                    .reduce((acc, curr) => acc + (curr.amount || 0), 0)

                setStats({
                    totalRevenue: total,
                    txCount: txs.length
                })
            }
        }
        fetchData()
    }, [activeWorkspace?.id])


    const getQuickAction = () => {
        if (tools.includes('pos')) return { label: 'New Sale (POS)', link: '/dashboard/pos' }
        if (tools.includes('invoices')) return { label: 'Create Invoice', link: '/dashboard/invoices/create' }
        if (tools.includes('jobs')) return { label: 'Log Billable Time', link: '/dashboard/time' }
        return { label: 'Add Transaction', link: '/dashboard/transactions' }
    }
    const quickAction = getQuickAction()

    return (
        <div className="space-y-8">
            {/* Header Section */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
                    <p className="text-muted-foreground capitalize">
                        {activeWorkspace?.tier === 'free' ? 'Your personal wealth at a glance.' : `${activeWorkspace?.name || 'Workspace'} Control Center`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Link href={quickAction.link}>
                        <Button className="gap-2 bg-primary hover:bg-primary/90 text-white">
                            <Plus className="h-4 w-4" />
                            {quickAction.label}
                        </Button>
                    </Link>
                </div>
            </div>

            {/* Modular Widget Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">

                {/* 1. SALES (POS) or FINANCIAL OVERVIEW */}
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
                        <DollarSign className="h-4 w-4 text-emerald-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">
                            ${stats.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <Activity className="h-3 w-3 text-emerald-400" />
                            <span className="text-emerald-400">{stats.txCount}</span>
                            <span className="opacity-50">transactions recorded</span>
                        </p>
                    </CardContent>
                </Card>

                {/* 2. KITCHEN (KDS) - Placeholder until Phase 3 */}
                {tools.includes('kitchen') && (
                    <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Kitchen Status</CardTitle>
                            <UtensilsCrossed className="h-4 w-4 text-orange-400" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-white">Open</div>
                            <p className="text-xs text-muted-foreground mt-1">Ready for orders</p>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Recent Activity Feed (Real Data) */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4 bg-white/5 border-white/10 text-white">
                    <CardHeader>
                        <CardTitle>Recent Activity</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-6">
                            {recentActivity.length > 0 ? (
                                recentActivity.map((tx) => (
                                    <div key={tx.id} className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${tx.type === 'income' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                                                {tx.type === 'income' ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
                                            </div>
                                            <div>
                                                <p className="font-medium">{tx.merchant || tx.description || 'Unknown Transaction'}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {tx.date ? format(new Date(tx.date), 'MMM d, h:mm a') : 'No Date'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className={`font-medium ${tx.type === 'income' ? 'text-emerald-500' : 'text-white'}`}>
                                            {tx.type === 'income' ? '+' : '-'}${Number(tx.amount).toFixed(2)}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    <p>No recent activity found.</p>
                                    <Button variant="link" asChild className="text-white mt-2">
                                        <Link href="/dashboard/transactions">Create your first transaction</Link>
                                    </Button>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Insights / Notifications */}
                <Card className="col-span-3 bg-gradient-to-br from-primary/20 to-purple-500/10 border-primary/20 text-white">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Activity className="h-5 w-5" /> Insights
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div className="p-3 bg-black/20 rounded-lg flex items-center gap-3 border border-white/5">
                                <Activity className="h-4 w-4 text-blue-400" />
                                <div className="text-sm">
                                    <span className="font-bold text-blue-400">Welcome!</span> Use the sidebar to manage your workspace.
                                </div>
                            </div>
                            <div className="mt-4">
                                <Link href="/dashboard/analytics">
                                    <Button variant="outline" className="w-full border-white/10 hover:bg-white/10 hover:text-white">
                                        View Analytics
                                    </Button>
                                </Link>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
