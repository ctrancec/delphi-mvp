"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Shield, Baby, Coins, Lock, ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useJunior } from '@/lib/contexts/junior-context'
// import { toast } from "sonner" 

export default function ParentalSettingsPage() {
    const router = useRouter()
    const { pinCode, updatePin, allowance, updateAllowance, enterJuniorMode } = useJunior()

    // Local state for inputs
    const [pinInput, setPinInput] = useState(pinCode || '')
    const [allowanceInput, setAllowanceInput] = useState(allowance.toString())

    const handleSavePin = () => {
        if (pinInput.length < 4) {
            alert("PIN must be at least 4 digits")
            return
        }
        updatePin(pinInput)
        alert("Security PIN updated successfully")
    }

    const handleSaveAllowance = () => {
        const val = parseFloat(allowanceInput)
        if (isNaN(val) || val < 0) {
            alert("Please enter a valid amount")
            return
        }
        updateAllowance(val)
        alert("Allowance updated")
    }

    return (
        <div className="space-y-8 max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Parental Controls</h2>
                    <p className="text-muted-foreground">
                        Configure Delphi Junior mode for your family.
                    </p>
                </div>
            </div>

            <div className="grid gap-6">
                {/* Security Section */}
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-emerald-500" />
                            Security Configuration
                        </CardTitle>
                        <CardDescription>
                            Set a PIN to prevent your child from exiting Junior Mode.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="pin">Exit PIN Code</Label>
                                <div className="relative">
                                    <Lock className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="pin"
                                        type="password"
                                        placeholder="Enter 4-digit PIN"
                                        value={pinInput}
                                        onChange={(e) => setPinInput(e.target.value)}
                                        className="pl-9 bg-black/20 border-white/10"
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground">Keep this PIN secret from your child.</p>
                            </div>
                            <div className="flex items-end">
                                <Button onClick={handleSavePin} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                                    Save PIN
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Allowance Section */}
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Coins className="h-5 w-5 text-yellow-500" />
                            Allowance Settings
                        </CardTitle>
                        <CardDescription>
                            Set the weekly available balance for Junior Mode.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="allowance">Weekly Allowance ($)</Label>
                                <Input
                                    id="allowance"
                                    type="number"
                                    placeholder="10.00"
                                    value={allowanceInput}
                                    onChange={(e) => setAllowanceInput(e.target.value)}
                                    className="bg-black/20 border-white/10"
                                />
                            </div>
                            <div className="flex items-end">
                                <Button onClick={handleSaveAllowance} variant="secondary" className="w-full">
                                    Update Allowance
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Mode Activation */}
                <Card className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border-indigo-500/20 backdrop-blur-md">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Baby className="h-5 w-5 text-indigo-400" />
                            Enter Junior Mode
                        </CardTitle>
                        <CardDescription>
                            Switch this device to the simplified, kid-friendly interface.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-between gap-4">
                            <p className="text-sm text-muted-foreground">
                                You will need the PIN to exit this mode. Ensure you have set it above.
                            </p>
                            <Button
                                onClick={enterJuniorMode}
                                className="bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                                disabled={!pinCode}
                            >
                                Launch Junior Mode
                            </Button>
                        </div>
                        {!pinCode && (
                            <p className="text-xs text-red-400 mt-2">
                                * Please set a PIN before launching Junior Mode.
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
