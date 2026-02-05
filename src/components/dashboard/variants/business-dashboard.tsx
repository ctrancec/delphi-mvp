"use client"

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DollarSign, Activity, Users, Truck, ShoppingBag, TrendingUp, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import Link from 'next/link'

import { Transaction } from '@/lib/contexts/mock-db-context'

interface BusinessDashboardProps {
    stats: {
        totalRevenue: number
        txCount: number
    }
    recentActivity: Transaction[]
    tools: string[]
}

export function BusinessDashboard({ stats, recentActivity, tools }: BusinessDashboardProps) {
    return (
        <div className="space-y-8">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* 1. Revenue */}
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
                            <TrendingUp className="h-3 w-3 text-emerald-400" />
                            <span className="text-emerald-400">+8.2%</span> from last week
                        </p>
                    </CardContent>
                </Card>

                {/* 2. Operations / Orders */}
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Active Orders</CardTitle>
                        <ShoppingBag className="h-4 w-4 text-blue-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">12</div>
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <span className="text-orange-400">3 pending</span> preparation
                        </p>
                    </CardContent>
                </Card>

                {/* 3. Staff */}
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Staff on Duty</CardTitle>
                        <Users className="h-4 w-4 text-purple-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">4</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Next shift starts in 2h
                        </p>
                    </CardContent>
                </Card>

                {/* 4. Alerts / Actions */}
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Needs Attention</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-orange-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">1</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Stock alert: Standard Milk
                        </p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-7">
                {/* Main Activity Feed */}
                <Card className="col-span-4 bg-white/5 border-white/10 text-white">
                    <CardHeader>
                        <CardTitle>Recent Business Activity</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {recentActivity.length > 0 ? (
                                recentActivity.map((tx) => (
                                    <div key={tx.id} className="flex items-center justify-between p-2 rounded hover:bg-white/5 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="h-8 w-8 rounded bg-white/10 flex items-center justify-center font-mono text-xs">
                                                TX
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm">{tx.payee || tx.description || 'Transaction'}</p>
                                                <p className="text-xs text-muted-foreground">{format(new Date(tx.date), 'MMM d, HH:mm')}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-mono font-medium">${Number(tx.amount).toFixed(2)}</div>
                                            <div className="text-[10px] text-muted-foreground uppercase">{tx.status}</div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-center text-muted-foreground py-8">No transactions yet.</p>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Quick Actions / Integration Status */}
                <Card className="col-span-3 bg-black/40 border-white/10 backdrop-blur">
                    <CardHeader>
                        <CardTitle className="text-sm">System Status</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 text-muted-foreground">
                                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                                POS Terminal
                            </span>
                            <span className="text-emerald-500">Online</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 text-muted-foreground">
                                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                                Kitchen Display
                            </span>
                            <span className="text-emerald-500">Connected</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 text-muted-foreground">
                                <div className="h-2 w-2 rounded-full bg-yellow-500" />
                                Uber Eats
                            </span>
                            <span className="text-yellow-500">Sync Warning</span>
                        </div>

                        <div className="pt-4 border-t border-white/10 grid grid-cols-2 gap-2">
                            <Button variant="outline" className="w-full text-xs" asChild>
                                <Link href="/dashboard/settings">Settings</Link>
                            </Button>
                            <Button variant="outline" className="w-full text-xs" asChild>
                                <Link href="/dashboard/team">Manage Team</Link>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
