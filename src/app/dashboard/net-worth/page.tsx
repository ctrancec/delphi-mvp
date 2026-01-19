"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus, TrendingUp, Wallet, Landmark, CreditCard, DollarSign } from "lucide-react"

export default function NetWorthPage() {
    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Net Worth</h2>
                    <p className="text-muted-foreground">
                        Your financial health snapshot.
                    </p>
                </div>
                <Button className="gap-2">
                    <Plus className="h-4 w-4" />
                    Add Asset
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <Card className="bg-emerald-950/20 border-emerald-500/20 backdrop-blur-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-emerald-400">Total Assets</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-white">$1,240,500</div>
                        <p className="text-xs text-muted-foreground mt-2">+5.2% this month</p>
                    </CardContent>
                </Card>
                <Card className="bg-red-950/20 border-red-500/20 backdrop-blur-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-red-400">Total Liabilities</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-white">$345,000</div>
                        <p className="text-xs text-muted-foreground mt-2">-1.0% this month (Good)</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="bg-black/40 border-white/10">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Landmark className="h-5 w-5 text-emerald-500" />
                            Assets
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex justify-between items-center p-3 rounded bg-white/5">
                            <span className="font-medium">Real Estate</span>
                            <span className="font-mono">$850,000</span>
                        </div>
                        <div className="flex justify-between items-center p-3 rounded bg-white/5">
                            <span className="font-medium">Investment Accounts</span>
                            <span className="font-mono">$320,500</span>
                        </div>
                        <div className="flex justify-between items-center p-3 rounded bg-white/5">
                            <span className="font-medium">Cash</span>
                            <span className="font-mono">$55,000</span>
                        </div>
                        <div className="flex justify-between items-center p-3 rounded bg-white/5">
                            <span className="font-medium">Vehicles</span>
                            <span className="font-mono">$15,000</span>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-black/40 border-white/10">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <CreditCard className="h-5 w-5 text-red-500" />
                            Liabilities
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex justify-between items-center p-3 rounded bg-white/5">
                            <span className="font-medium">Mortgage</span>
                            <span className="font-mono">$320,000</span>
                        </div>
                        <div className="flex justify-between items-center p-3 rounded bg-white/5">
                            <span className="font-medium">Car Loan</span>
                            <span className="font-mono">$12,000</span>
                        </div>
                        <div className="flex justify-between items-center p-3 rounded bg-white/5">
                            <span className="font-medium">Credit Cards</span>
                            <span className="font-mono">$13,000</span>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
