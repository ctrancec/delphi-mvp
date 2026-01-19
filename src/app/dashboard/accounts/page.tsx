"use client"

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus, CreditCard, Landmark, ArrowUpRight, TrendingUp } from 'lucide-react'
import { cn } from "@/lib/utils"

const ACCOUNTS = [
    {
        id: "acc_1",
        name: "Primary Checking",
        institution: "Chase",
        type: "Checking",
        balance: 14250.80,
        change: "+2.4%",
        last4: "4422",
        color: "from-blue-600 to-blue-400"
    },
    {
        id: "acc_2",
        name: "High Yield Savings",
        institution: "Ally",
        type: "Savings",
        balance: 52000.00,
        change: "+0.5%",
        last4: "8891",
        color: "from-purple-600 to-purple-400"
    },
    {
        id: "acc_3",
        name: "Venture X",
        institution: "Capital One",
        type: "Credit Card",
        balance: -1240.50,
        limit: 30000,
        last4: "3310",
        color: "from-emerald-600 to-emerald-400"
    },
    {
        id: "acc_4",
        name: "Brokerage",
        institution: "Vanguard",
        type: "Investment",
        balance: 128450.22,
        change: "+5.2%",
        last4: "1120",
        color: "from-orange-600 to-orange-400"
    }
]

export default function AccountsPage() {
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
                    <Button
                        className="bg-primary hover:bg-primary/90 text-white"
                        onClick={() => alert("Bank Integration (Plaid/Stripe) coming in Phase 4!")}
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Connect Account
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {ACCOUNTS.map(account => (
                    <Card key={account.id} className="relative overflow-hidden border-white/10 bg-white/5 transition-all hover:bg-white/10 group">
                        <div className={cn("absolute inset-0 opacity-0 group-hover:opacity-10 bg-gradient-to-br transition-opacity", account.color)} />

                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <div className="space-y-1">
                                <CardTitle className="text-lg font-medium">{account.name}</CardTitle>
                                <CardDescription className="flex items-center gap-1">
                                    {account.institution} •••• {account.last4}
                                </CardDescription>
                            </div>
                            <div className={cn("p-2 rounded-full bg-gradient-to-br opacity-80", account.color)}>
                                {account.type === 'Credit Card' ? <CreditCard className="h-5 w-5 text-white" /> : <Landmark className="h-5 w-5 text-white" />}
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-white mb-1">
                                {account.type === 'Credit Card' ? '-' : ''}${Math.abs(account.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">{account.type}</span>
                                {account.change && (
                                    <span className="text-emerald-500 flex items-center gap-0.5">
                                        <TrendingUp className="h-3 w-3" />
                                        {account.change}
                                    </span>
                                )}
                                {account.limit && (
                                    <span className="text-muted-foreground">
                                        Limit: ${account.limit.toLocaleString()}
                                    </span>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}

                {/* Add New Placeholder */}
                <Card className="flex flex-col items-center justify-center border-dashed border-white/20 bg-transparent hover:bg-white/5 cursor-pointer h-full min-h-[160px]">
                    <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center mb-4">
                        <Plus className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="font-medium text-muted-foreground">Add New Account</div>
                </Card>
            </div>

            {/* Recent Activity Mini-Section */}
            <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                <CardHeader>
                    <CardTitle>Recent Synced Activity</CardTitle>
                    <CardDescription>Latest transactions from all connected accounts.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {[
                            { name: "Whole Foods Market", amount: -84.20, date: "Today", account: "Venture X" },
                            { name: "Spotify Premium", amount: -11.99, date: "Yesterday", account: "Primary Checking" },
                            { name: "Direct Deposit - ACME Corp", amount: 4250.00, date: "Oct 15", account: "Primary Checking" },
                        ].map((tx, i) => (
                            <div key={i} className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className={cn(
                                        "h-10 w-10 rounded-full flex items-center justify-center",
                                        tx.amount > 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-white/10 text-white"
                                    )}>
                                        <ArrowUpRight className={cn("h-5 w-5", tx.amount > 0 && "rotate-180")} />
                                    </div>
                                    <div>
                                        <div className="font-medium text-white">{tx.name}</div>
                                        <div className="text-xs text-muted-foreground">{tx.date} • {tx.account}</div>
                                    </div>
                                </div>
                                <div className={cn("font-medium", tx.amount > 0 ? "text-emerald-500" : "text-white")}>
                                    {tx.amount > 0 ? '+' : ''}{tx.amount.toFixed(2)}
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
