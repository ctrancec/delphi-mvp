"use client"

import { useJunior } from '@/lib/contexts/junior-context'
import { Trophy, Star, PiggyBank, CheckCircle, Lock, LogOut } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

export default function JuniorDashboard() {
    const { allowance, exitJuniorMode } = useJunior()
    const [pinInput, setPinInput] = useState('')
    const [error, setError] = useState('')

    const handleExit = () => {
        const success = exitJuniorMode(pinInput)
        if (!success) {
            setError("Incorrect PIN. Ask your parents for help!")
        }
    }

    return (
        <div className="space-y-8">
            {/* Header / Greeting */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-4xl font-extrabold mb-2">Hello, Captain! 🚀</h1>
                    <p className="text-indigo-200 text-lg">Ready to manage your treasure?</p>
                </div>

                {/* Exit Button */}
                <Dialog>
                    <DialogTrigger asChild>
                        <Button variant="ghost" className="text-indigo-300 hover:text-white hover:bg-indigo-800">
                            <LogOut className="h-5 w-5 mr-2" />
                            Exit Junior Mode
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-indigo-950 border-indigo-500 text-white">
                        <DialogHeader>
                            <DialogTitle>Parents Only!</DialogTitle>
                            <DialogDescription className="text-indigo-300">
                                Enter your 4-digit security PIN to exit Junior Mode.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <Input
                                type="password"
                                placeholder="0000"
                                className="text-center text-2xl tracking-widest bg-indigo-900/50 border-indigo-500 text-white h-16"
                                maxLength={4}
                                value={pinInput}
                                onChange={(e) => {
                                    setPinInput(e.target.value)
                                    setError('')
                                }}
                            />
                            {error && <p className="text-red-400 text-center text-sm font-bold">{error}</p>}
                            <Button
                                onClick={handleExit}
                                className="w-full bg-yellow-400 hover:bg-yellow-500 text-indigo-950 font-bold h-12 text-lg"
                            >
                                Unlock Dashboard
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Main Widgets */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* Allowance Card */}
                <div className="col-span-1 md:col-span-2 bg-gradient-to-br from-indigo-600 to-blue-600 rounded-3xl p-8 shadow-2xl relative overflow-hidden group hover:scale-[1.01] transition-transform duration-300">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl" />
                    <div className="relative z-10">
                        <div className="flex items-start justify-between mb-8">
                            <div>
                                <h3 className="text-indigo-200 font-bold text-lg uppercase tracking-wider mb-1">Current Balance</h3>
                                <div className="text-7xl font-black text-white tracking-tight">
                                    ${allowance.toFixed(2)}
                                </div>
                            </div>
                            <div className="h-16 w-16 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                                <PiggyBank className="h-8 w-8 text-white" />
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <Button className="flex-1 bg-white/20 hover:bg-white/30 text-white border-0 h-12 rounded-xl text-lg font-bold">
                                Request $$
                            </Button>
                            <Button className="flex-1 bg-white text-indigo-600 hover:bg-gray-100 border-0 h-12 rounded-xl text-lg font-bold">
                                Save it!
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Savings Goal */}
                <div className="col-span-1 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-3xl p-8 shadow-2xl flex flex-col justify-between group hover:scale-[1.02] transition-transform duration-300">
                    <div>
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="text-emerald-100 font-bold text-lg">Next Goal</h3>
                            <Trophy className="h-6 w-6 text-yellow-300" />
                        </div>
                        <h4 className="text-2xl font-bold text-white mb-2">LEGO Set</h4>
                        <div className="w-full bg-emerald-900/30 h-4 rounded-full overflow-hidden mb-2">
                            <div className="bg-yellow-400 h-full w-[65%]" />
                        </div>
                        <p className="text-emerald-100 text-sm">$65.00 / $100.00</p>
                    </div>
                    <div className="mt-4 pt-4 border-t border-emerald-400/30">
                        <p className="text-xs text-emerald-100 font-medium">
                            "You're doing great! Keep saving!"
                        </p>
                    </div>
                </div>
            </div>

            {/* Chores Section */}
            <div className="bg-indigo-900/40 backdrop-blur-lg border border-indigo-500/30 rounded-3xl p-8">
                <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                    <CheckCircle className="h-6 w-6 text-green-400" />
                    Missions (Chores)
                </h3>
                <div className="grid gap-4">
                    {[
                        { title: "Clean Room", reward: "$2.00", done: true },
                        { title: "Do Homework", reward: "$5.00", done: false },
                        { title: "Walk the Dog", reward: "$3.00", done: false }
                    ].map((chore, i) => (
                        <div key={i} className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${chore.done ? 'bg-indigo-500/20 border-indigo-500/30 opacity-60' : 'bg-indigo-800/50 border-indigo-500/50 hover:bg-indigo-800'}`}>
                            <div className="flex items-center gap-4">
                                <div className={`h-8 w-8 rounded-full border-2 flex items-center justify-center ${chore.done ? 'bg-green-500 border-green-500' : 'border-indigo-400'}`}>
                                    {chore.done && <CheckCircle className="h-5 w-5 text-white" />}
                                </div>
                                <span className={`font-bold text-lg ${chore.done ? 'line-through text-indigo-300' : 'text-white'}`}>{chore.title}</span>
                            </div>
                            <div className="bg-yellow-400/10 text-yellow-400 px-3 py-1 rounded-lg font-bold">
                                +{chore.reward}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
