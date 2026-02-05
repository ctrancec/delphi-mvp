"use client"

import React, { useState } from 'react'
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { CheckCircle2, Circle, PiggyBank, Gamepad2, Star, Trophy, ArrowRight } from 'lucide-react'
import { cn } from "@/lib/utils"

export default function DelphiJuniorPage() {
    // Mock Data for MVP
    const [balance, setBalance] = useState(45.50)
    const [allowanceProgress, setAllowanceProgress] = useState(60) // 60% to Friday

    // Mock Chores
    const [chores, setChores] = useState([
        { id: 1, title: 'Make Bed', reward: 1.00, completed: true, icon: '🛏️' },
        { id: 2, title: 'Clean Room', reward: 2.00, completed: false, icon: '🧹' },
        { id: 3, title: 'Do Homework', reward: 3.00, completed: false, icon: '📚' },
        { id: 4, title: 'Walk Dog', reward: 1.50, completed: false, icon: '🐕' },
    ])

    // Mock Goals
    const [goals, setGoals] = useState([
        { id: 1, title: 'LEGO Set', target: 80, current: 45.50, color: 'bg-blue-500' },
        { id: 2, title: 'New Game', target: 60, current: 20.00, color: 'bg-purple-500' },
    ])

    const handleToggleChore = (id: number) => {
        setChores(prev => prev.map(c => {
            if (c.id === id) {
                // Optimistic balance update
                if (!c.completed) setBalance(b => b + c.reward)
                else setBalance(b => b - c.reward)
                return { ...c, completed: !c.completed }
            }
            return c
        }))
    }

    return (
        <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8 font-sans">
            {/* Header / Top Bar */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center border-2 border-white/20">
                        <Gamepad2 className="h-6 w-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                            Delphi Junior
                        </h1>
                        <p className="text-slate-400 text-sm">Level 5 Saver</p>
                    </div>
                </div>

                {/* Balance Pill */}
                <div className="bg-slate-900 border border-slate-800 rounded-full py-2 px-6 flex items-center gap-2 shadow-lg shadow-purple-900/10">
                    <div className="h-8 w-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <span className="text-emerald-400 font-bold">$</span>
                    </div>
                    <span className="text-2xl font-black text-white tracking-tight">
                        ${balance.toFixed(2)}
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* LEFT COL: Chores (Quests) */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                            Daily Quests
                        </h2>
                        <span className="text-slate-400 text-sm">3 available</span>
                    </div>

                    <div className="grid gap-4">
                        {chores.map(chore => (
                            <Card
                                key={chore.id}
                                onClick={() => handleToggleChore(chore.id)}
                                className={cn(
                                    "border-0 transition-all cursor-pointer group relative overflow-hidden",
                                    chore.completed
                                        ? "bg-emerald-950/30 ring-1 ring-emerald-500/20"
                                        : "bg-slate-900 hover:bg-slate-800 ring-1 ring-white/5 hover:ring-indigo-500/50"
                                )}
                            >
                                <CardContent className="p-4 flex items-center justify-between relative z-10">
                                    <div className="flex items-center gap-4">
                                        <div className={cn(
                                            "h-12 w-12 rounded-2xl flex items-center justify-center text-2xl transition-transform group-hover:scale-110",
                                            chore.completed ? "bg-emerald-500/20 grayscale-0" : "bg-slate-800 grayscale"
                                        )}>
                                            {chore.icon}
                                        </div>
                                        <div>
                                            <h3 className={cn("font-bold text-lg", chore.completed && "text-emerald-400 line-through decoration-2 decoration-emerald-500/50")}>
                                                {chore.title}
                                            </h3>
                                            <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">
                                                Reward: ${chore.reward.toFixed(2)}
                                            </p>
                                        </div>
                                    </div>

                                    <div className={cn(
                                        "h-8 w-8 rounded-full border-2 flex items-center justify-center transition-all duration-300",
                                        chore.completed
                                            ? "bg-emerald-500 border-emerald-500 scale-100"
                                            : "border-slate-600 group-hover:border-indigo-400"
                                    )}>
                                        {chore.completed && <CheckCircle2 className="h-5 w-5 text-white" />}
                                    </div>
                                </CardContent>
                                {chore.completed && (
                                    <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 to-transparent pointer-events-none" />
                                )}
                            </Card>
                        ))}
                    </div>
                </div>

                {/* RIGHT COL: Goals & Stats */}
                <div className="space-y-8">
                    {/* Allowance Tracker */}
                    <Card className="bg-gradient-to-br from-indigo-900 to-slate-900 border-indigo-500/20">
                        <CardContent className="p-6 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-bold text-indigo-200">Weekly Allowance</h3>
                                <span className="text-white font-mono text-sm bg-indigo-500/20 px-2 py-1 rounded">
                                    $10.00 / week
                                </span>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs text-indigo-300">
                                    <span>Last Paid: Monday</span>
                                    <span>Next: Friday</span>
                                </div>
                                <Progress value={allowanceProgress} className="h-3 bg-slate-800" indicatorClassName="bg-indigo-500" />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Savings Goals */}
                    <div>
                        <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
                            <PiggyBank className="h-5 w-5 text-pink-500" />
                            Savings Goals
                        </h2>

                        <div className="space-y-4">
                            {goals.map(goal => {
                                const percent = Math.min(100, (goal.current / goal.target) * 100)
                                return (
                                    <div key={goal.id} className="bg-slate-900/50 border border-white/5 rounded-2xl p-4 space-y-3">
                                        <div className="flex justify-between items-end">
                                            <span className="font-bold">{goal.title}</span>
                                            <span className="text-xs text-slate-400">
                                                ${goal.current} / ${goal.target}
                                            </span>
                                        </div>
                                        <div className="relative h-4 bg-slate-800 rounded-full overflow-hidden">
                                            <div
                                                className={cn("h-full rounded-full transition-all duration-500", goal.color)}
                                                style={{ width: `${percent}%` }}
                                            />
                                        </div>
                                        <div className="flex justify-end">
                                            <Button size="sm" variant="ghost" className="h-6 text-xs text-slate-400 hover:text-white hover:bg-white/5">
                                                Add Money <ArrowRight className="h-3 w-3 ml-1" />
                                            </Button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Fun Stats */}
                    <Card className="bg-slate-900 border-white/5">
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="h-10 w-10 rounded-full bg-yellow-500/10 flex items-center justify-center">
                                <Trophy className="h-5 w-5 text-yellow-500" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold text-white">12</div>
                                <div className="text-xs text-slate-400 uppercase font-bold">Quests Completed</div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
