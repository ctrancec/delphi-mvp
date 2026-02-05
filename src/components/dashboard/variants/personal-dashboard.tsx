"use client"

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowUpRight, ArrowDownRight, Activity, TrendingUp, PiggyBank, Wallet } from 'lucide-react'
import { format } from 'date-fns'
import Link from 'next/link'

import { Transaction } from '@/lib/contexts/mock-db-context'

interface PersonalDashboardProps {
    stats: {
        totalRevenue: number // Treated as Net Worth or Balance here
        txCount: number
    }
    recentActivity: Transaction[]
}

export function PersonalDashboard({ stats, recentActivity }: PersonalDashboardProps) {
    return (
        <div className="space-y-8">
            <div className="grid gap-4 md:grid-cols-3">
                {/* 1. Net Worth */}
                <Card className="bg-gradient-to-br from-indigo-900/50 to-blue-900/50 border-indigo-500/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-indigo-200">Total Balance</CardTitle>
                        <Wallet className="h-4 w-4 text-indigo-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">
                            ${stats.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                        <p className="text-xs text-indigo-300 mt-1">
                            Across all connected accounts
                        </p>
                    </CardContent>
                </Card>

                {/* 2. Monthly Spending */}
                <Card className="bg-white/5 border-white/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Monthly Spending</CardTitle>
                        <ArrowDownRight className="h-4 w-4 text-red-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">$1,240.50</div>
                        <p className="text-xs text-muted-foreground mt-1">
                            <span className="text-red-400">+12%</span> from last month
                        </p>
                    </CardContent>
                </Card>

                {/* 3. Savings Goal */}
                <Card className="bg-white/5 border-white/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Savings Goal: Europe</CardTitle>
                        <PiggyBank className="h-4 w-4 text-emerald-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">$2,500 / $5,000</div>
                        <div className="w-full bg-white/10 h-1 mt-2 rounded-full overflow-hidden">
                            <div className="bg-emerald-500 h-full w-[50%]" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Recent Personal Transactions */}
            <Card className="bg-white/5 border-white/10 text-white">
                <CardHeader>
                    <CardTitle>Recent Spending</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-6">
                        {recentActivity.length > 0 ? (
                            recentActivity.map((tx) => (
                                <div key={tx.id} className="flex items-center justify-between group">
                                    <div className="flex items-center gap-4">
                                        <div className={`h-10 w-10 rounded-full flex items-center justify-center transition-colors group-hover:bg-white/10 ${tx.type === 'income' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                                            {tx.type === 'income' ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
                                        </div>
                                        <div>
                                            <p className="font-medium group-hover:text-primary transition-colors">{tx.payee || tx.description || 'Unknown Transaction'}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {tx.date ? format(new Date(tx.date), 'MMM d, h:mm a') : 'No Date'} · {tx.category || 'Uncategorized'}
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
        </div>
    )
}
