"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, CheckCircle2, DollarSign, PieChart, Plus } from "lucide-react"

export default function BudgetPage() {
    const categories = [
        { name: "Housing", budget: 2000, spent: 2000, color: "bg-blue-500" },
        { name: "Food & Dining", budget: 600, spent: 450, color: "bg-emerald-500" },
        { name: "Transportation", budget: 400, spent: 380, color: "bg-yellow-500" },
        { name: "Entertainment", budget: 300, spent: 420, color: "bg-red-500" },
        { name: "Savings", budget: 1000, spent: 1000, color: "bg-purple-500" },
    ]

    const totalBudget = categories.reduce((acc, cat) => acc + cat.budget, 0)
    const totalSpent = categories.reduce((acc, cat) => acc + cat.spent, 0)
    const percentUsed = Math.round((totalSpent / totalBudget) * 100)

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Monthly Budget</h2>
                    <p className="text-muted-foreground">
                        February 2026 Overview
                    </p>
                </div>
                <Button variant="outline" className="gap-2 border-white/10 hover:bg-white/5">
                    <Plus className="h-4 w-4" />
                    Adjust Limits
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Budget</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">${totalBudget.toLocaleString()}</div>
                    </CardContent>
                </Card>
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Amount Spent</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">${totalSpent.toLocaleString()}</div>
                        <Progress value={percentUsed} className="mt-4 h-2" />
                        <p className="text-xs text-muted-foreground mt-2">{percentUsed}% used</p>
                    </CardContent>
                </Card>
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Remaining</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-400">${(totalBudget - totalSpent).toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground mt-2">12 days left in month</p>
                    </CardContent>
                </Card>
            </div>

            <Card className="bg-black/40 border-white/10">
                <CardHeader>
                    <CardTitle>Category Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    {categories.map((cat) => {
                        const percent = Math.min(100, Math.round((cat.spent / cat.budget) * 100))
                        const isOver = cat.spent > cat.budget

                        return (
                            <div key={cat.name} className="space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span className="font-medium text-white">{cat.name}</span>
                                    <div className="flex gap-2 text-muted-foreground">
                                        <span className={isOver ? "text-red-400 font-bold" : ""}>
                                            ${cat.spent}
                                        </span>
                                        <span>/</span>
                                        <span>${cat.budget}</span>
                                    </div>
                                </div>
                                <Progress value={percent} className="h-2" indicatorClassName={isOver ? "bg-red-500" : cat.color} />
                                {isOver && (
                                    <p className="text-xs text-red-400 flex items-center gap-1">
                                        <AlertCircle className="h-3 w-3" />
                                        Over budget by ${cat.spent - cat.budget}
                                    </p>
                                )}
                            </div>
                        )
                    })}
                </CardContent>
            </Card>
        </div>
    )
}
