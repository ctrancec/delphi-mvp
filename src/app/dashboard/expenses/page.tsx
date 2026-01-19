import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
    Plus,
    Search,
    Filter,
    Upload,
    Receipt,
    Coffee,
    Server,
    Briefcase
} from 'lucide-react'

export default async function ExpensesPage() {
    const supabase = await createClient()

    let user = null;

    if (supabase) {
        const { data } = await supabase.auth.getUser()
        user = data.user
    } else {
        // Mock Mode
        user = { email: 'demo@delphi.com', id: 'mock-user-id' } as any
    }

    if (!user) {
        redirect('/login')
    }

    const expenses = [
        { id: 1, merchant: "AWS Web Services", category: "Software", amount: 145.00, date: "2024-01-15", receipt: true, icon: Server },
        { id: 2, merchant: "Starbucks", category: "Meals", amount: 12.50, date: "2024-01-14", receipt: false, icon: Coffee },
        { id: 3, merchant: "WeWork", category: "Rent", amount: 450.00, date: "2024-01-01", receipt: true, icon: Briefcase },
        { id: 4, merchant: "Uber", category: "Travel", amount: 24.90, date: "2024-01-12", receipt: true, icon: Briefcase },
    ]

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Expenses</h2>
                    <p className="text-muted-foreground">
                        Track business spending and uploads receipts.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" className="gap-2 border-white/10 hover:bg-white/5">
                        <Upload className="h-4 w-4" />
                        Upload Receipt
                    </Button>
                    <Button className="gap-2 bg-primary hover:bg-primary/90 text-white">
                        <Plus className="h-4 w-4" />
                        Add Expense
                    </Button>
                </div>
            </div>

            {/* Spending Breakdown */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Spending (Jan)</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">$632.40</div>
                        <Progress value={65} className="mt-4 h-2" />
                        <p className="text-xs text-muted-foreground mt-2">65% of monthly budget used.</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Tax Deductible</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">$619.90</div>
                        <p className="text-xs text-muted-foreground mt-2 text-emerald-400">Potential tax savings: ~$154.00</p>
                    </CardContent>
                </Card>

                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Receipt Health</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">75%</div>
                        <p className="text-xs text-muted-foreground mt-2 text-yellow-400">3 transactions missing receipts.</p>
                    </CardContent>
                </Card>
            </div>

            {/* Expense List */}
            <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                <div className="p-4 flex items-center gap-4 border-b border-white/10">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="search"
                            placeholder="Search merchant..."
                            className="pl-9 bg-white/5 border-white/10 text-white focus-visible:ring-primary/20"
                        />
                    </div>
                    <Button variant="outline" className="border-white/10 text-muted-foreground hover:text-white hover:bg-white/5">
                        <Filter className="h-4 w-4 mr-2" />
                        Filter
                    </Button>
                </div>

                <div className="p-0">
                    {expenses.map((expense) => {
                        const Icon = expense.icon
                        return (
                            <div key={expense.id} className="flex items-center justify-between p-4 border-b border-white/5 hover:bg-white/5 transition-colors last:border-0">
                                <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-white">
                                        <Icon className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-white">{expense.merchant}</p>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span>{expense.date}</span>
                                            <span>•</span>
                                            <span>{expense.category}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    {expense.receipt ? (
                                        <Badge variant="outline" className="border-emerald-500/20 text-emerald-500 bg-emerald-500/10">
                                            <Receipt className="h-3 w-3 mr-1" />
                                            Receipt
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline" className="border-yellow-500/20 text-yellow-500 bg-yellow-500/10">
                                            Missing
                                        </Badge>
                                    )}
                                    <div className="font-medium text-white w-[80px] text-right">
                                        -${expense.amount.toFixed(2)}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </Card>
        </div>
    )
}
