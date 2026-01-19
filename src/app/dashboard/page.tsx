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

export default function DashboardPage() {
    const { activeWorkspace } = useWorkspace()
    const tools = activeWorkspace.enabledTools

    // --- Dynamic Widget Data ---
    const salesData = { total: "$8,540.00", transactions: 142, trend: "+8%" }
    const kitchenData = { activeOrders: 12, avgTime: "18m", status: "Busy" }
    const shiftData = { onShift: ["Alice", "Bob", "Eve"], nextShift: "5:00 PM" }
    const taxData = { nextDue: "Apr 15", amount: "$12k", status: "Upcoming" }
    const inventoryData = { lowStock: 3, value: "$4.2k" }

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
                        {activeWorkspace.tier === 'free' ? 'Your personal wealth at a glance.' : `${activeWorkspace.name} Control Center`}
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

                {/* 1. SALES (POS) */}
                {tools.includes('pos') && (
                    <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Today's Sales</CardTitle>
                            <DollarSign className="h-4 w-4 text-emerald-400" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-white">{salesData.total}</div>
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                <ArrowUpRight className="h-3 w-3 text-emerald-400" />
                                <span className="text-emerald-400">{salesData.trend}</span>
                                <span className="opacity-50">vs yesterday</span>
                            </p>
                        </CardContent>
                    </Card>
                )}

                {/* 2. KITCHEN (KDS) */}
                {tools.includes('kitchen') && (
                    <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Kitchen Status</CardTitle>
                            <UtensilsCrossed className="h-4 w-4 text-orange-400" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-white">{kitchenData.activeOrders} Orders</div>
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                <span>{kitchenData.avgTime} avg ticket time</span>
                            </p>
                        </CardContent>
                    </Card>
                )}

                {/* 3. STAFF (Shifts) */}
                {tools.includes('shifts') && (
                    <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">On Shift</CardTitle>
                            <Users className="h-4 w-4 text-blue-400" />
                        </CardHeader>
                        <CardContent>
                            <div className="flex -space-x-2 mt-1">
                                {shiftData.onShift.map((name, i) => (
                                    <div key={i} className="h-8 w-8 rounded-full bg-zinc-800 border-2 border-black flex items-center justify-center text-[10px] font-bold text-white" title={name}>
                                        {name[0]}
                                    </div>
                                ))}
                                <div className="h-8 w-8 rounded-full bg-zinc-900 border-2 border-black flex items-center justify-center text-[10px] text-muted-foreground">
                                    +2
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">Next shift starts at {shiftData.nextShift}</p>
                        </CardContent>
                    </Card>
                )}

                {/* 4. INVENTORY */}
                {tools.includes('inventory') && (
                    <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Low Stock</CardTitle>
                            <Package className="h-4 w-4 text-yellow-400" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-white">{inventoryData.lowStock} Items</div>
                            <p className="text-xs text-muted-foreground mt-1 text-yellow-400">
                                Restock recommended
                            </p>
                        </CardContent>
                    </Card>
                )}

                {/* 5. TAXES */}
                {tools.includes('taxes') && (
                    <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Next Tax Payment</CardTitle>
                            <FileText className="h-4 w-4 text-purple-400" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-white">{taxData.nextDue}</div>
                            <Badge variant="outline" className="mt-1 border-purple-500/20 text-purple-500 bg-purple-500/10">
                                Est: {taxData.amount}
                            </Badge>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Recent Activity Feed (Universal) */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4 bg-white/5 border-white/10 text-white">
                    <CardHeader>
                        <CardTitle>Recent Activity</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-6">
                            {[
                                { id: 1, name: "Stripe Payout", amount: "+$1,200.00", date: "Today, 9:00 AM", type: "income" },
                                { id: 2, name: "Uber Eats Order #992", amount: "+$45.50", date: "Today, 10:30 AM", type: "income" },
                                { id: 3, name: "Inventory Restock", amount: "-$340.00", date: "Yesterday", type: "expense" },
                                { id: 4, name: "Staff Payroll", amount: "-$2,400.00", date: "Friday", type: "expense" },
                            ].map((tx) => (
                                <div key={tx.id} className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className={`h-10 w-10 rounded-full flex items-center justify-center ${tx.type === 'income' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                                            {tx.type === 'income' ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
                                        </div>
                                        <div>
                                            <p className="font-medium">{tx.name}</p>
                                            <p className="text-xs text-muted-foreground">{tx.date}</p>
                                        </div>
                                    </div>
                                    <div className={`font-medium ${tx.type === 'income' ? 'text-emerald-500' : 'text-white'}`}>
                                        {tx.amount}
                                    </div>
                                </div>
                            ))}
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
                            {tools.includes('delivery') && (
                                <div className="p-3 bg-black/20 rounded-lg flex items-center gap-3 border border-white/5">
                                    <Truck className="h-4 w-4 text-blue-400" />
                                    <div className="text-sm">
                                        <span className="font-bold text-blue-400">Delivery Spike:</span> 15 orders in last hour.
                                    </div>
                                </div>
                            )}
                            {tools.includes('inventory') && (
                                <div className="p-3 bg-black/20 rounded-lg flex items-center gap-3 border border-white/5">
                                    <AlertCircle className="h-4 w-4 text-yellow-400" />
                                    <div className="text-sm">
                                        <span className="font-bold text-yellow-400">Low Stock:</span> Coffee Beans below threshold.
                                    </div>
                                </div>
                            )}
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
