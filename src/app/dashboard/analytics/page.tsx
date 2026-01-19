"use client"

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { BarChart3, TrendingUp, LineChart, PieChart } from 'lucide-react'
import { RevenueChart } from '@/components/features/analytics/revenue-chart'
import { CategoryPieChart } from '@/components/features/analytics/category-pie-chart'

export default function AnalyticsPage() {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Analytics</h2>
                <p className="text-muted-foreground">Deep dive into your financial performance.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Revenue Growth</CardTitle>
                        <TrendingUp className="h-4 w-4 text-emerald-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">+24.5%</div>
                        <p className="text-xs text-muted-foreground">Compared to last month</p>
                    </CardContent>
                </Card>
                <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Profit Margin</CardTitle>
                        <BarChart3 className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">18.2%</div>
                        <p className="text-xs text-muted-foreground">+2.1% from last quarter</p>
                    </CardContent>
                </Card>
                <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Expenses</CardTitle>
                        <PieChart className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">$12,450</div>
                        <p className="text-xs text-muted-foreground">-4% decrease (good)</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4 bg-black/40 border-white/10 backdrop-blur-xl">
                    <CardHeader>
                        <CardTitle>Revenue vs Expenses</CardTitle>
                        <CardDescription>
                            Monthly financial overview for the current fiscal year.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <RevenueChart />
                    </CardContent>
                </Card>
                <Card className="col-span-3 bg-black/40 border-white/10 backdrop-blur-xl">
                    <CardHeader>
                        <CardTitle>Sales by Category</CardTitle>
                        <CardDescription>
                            Distribution of sales across product categories.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <CategoryPieChart />
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
