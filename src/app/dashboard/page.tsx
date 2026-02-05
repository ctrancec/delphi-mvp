"use client"

import { Transaction } from '@/lib/contexts/mock-db-context'
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
import { PersonalDashboard } from "@/components/dashboard/variants/personal-dashboard"
import { BusinessDashboard } from "@/components/dashboard/variants/business-dashboard"

export default function DashboardPage() {
    const { activeWorkspace } = useWorkspace()
    const tools = activeWorkspace?.enabledTools || [] // Safe access
    const [recentActivity, setRecentActivity] = useState<Transaction[]>([])
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

            {/* Conditional Dashboard Rendering */}
            {activeWorkspace?.type === 'personal' ? (
                <PersonalDashboard stats={stats} recentActivity={recentActivity} />
            ) : (
                <BusinessDashboard stats={stats} recentActivity={recentActivity} tools={tools} />
            )}
        </div>
    )
}
