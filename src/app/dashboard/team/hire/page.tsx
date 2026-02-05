"use client"

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useMockDatabase } from '@/lib/contexts/mock-db-context'
import { useWorkspace } from '@/lib/contexts/workspace-context'
import { ArrowLeft, UserPlus, Shield, User, Mail, Building, CheckCircle2, Copy } from 'lucide-react'
import { UserRole } from '@/lib/types/tool-registry'
import { cn } from "@/lib/utils"

export default function HirePage() {
    const router = useRouter()
    const { activeWorkspace } = useWorkspace()
    const { generateEmployeeId, linkUser } = useMockDatabase()

    const [step, setStep] = useState(1) // 1: Details, 2: Review/Generate, 3: Success
    const [loading, setLoading] = useState(false)

    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        role: 'staff' as UserRole,
        hierarchyLevel: '4', // Default to Employee
        personalEmail: '',
        salary: ''
    })

    const [generatedId, setGeneratedId] = useState('')

    const handleGenerate = async () => {
        if (!formData.firstName || !formData.lastName) return
        setLoading(true)
        // Simulate API delay
        await new Promise(r => setTimeout(r, 800))
        const id = await generateEmployeeId(formData.firstName, formData.lastName)
        setGeneratedId(id)
        setLoading(false)
        setStep(2)
    }

    const handleConfirmHire = async () => {
        setLoading(true)

        // Create the Link
        await linkUser({
            workspaceId: activeWorkspace.id,
            personalUserId: 'pending_invite', // Mock
            businessUserId: generatedId,
            status: 'active',
            employeeId: generatedId,
            personalEmail: formData.personalEmail
        })

        await new Promise(r => setTimeout(r, 1000)) // Drama pause
        setLoading(false)
        setStep(3)
    }

    const handleCopy = () => {
        navigator.clipboard.writeText(generatedId)
    }

    return (
        <div className="max-w-2xl mx-auto py-8 space-y-8">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">Hire New Employee</h1>
                    <p className="text-muted-foreground">Create a structured Enterprise Identity.</p>
                </div>
            </div>

            <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                {step === 1 && (
                    <>
                        <CardHeader>
                            <CardTitle>Employee Details</CardTitle>
                            <CardDescription>Enter the personal details of the new hire.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>First Name</Label>
                                    <Input
                                        className="bg-white/5 border-white/10"
                                        placeholder="Jane"
                                        value={formData.firstName}
                                        onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Last Name</Label>
                                    <Input
                                        className="bg-white/5 border-white/10"
                                        placeholder="Doe"
                                        value={formData.lastName}
                                        onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Role & Hierarchy</Label>
                                <div className="grid grid-cols-2 gap-4">
                                    <Select
                                        value={formData.role}
                                        onValueChange={(v: UserRole) => setFormData({ ...formData, role: v })}
                                    >
                                        <SelectTrigger className="bg-white/5 border-white/10">
                                            <SelectValue placeholder="Role" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="manager">Manager</SelectItem>
                                            <SelectItem value="staff">Staff</SelectItem>
                                            <SelectItem value="chef">Chef</SelectItem>
                                        </SelectContent>
                                    </Select>

                                    <Select
                                        value={formData.hierarchyLevel}
                                        onValueChange={v => setFormData({ ...formData, hierarchyLevel: v })}
                                    >
                                        <SelectTrigger className="bg-white/5 border-white/10">
                                            <SelectValue placeholder="Level" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="2">Level 2 (Upper Mgmt)</SelectItem>
                                            <SelectItem value="3">Level 3 (Lower Mgmt)</SelectItem>
                                            <SelectItem value="4">Level 4 (Employee)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Personal Email (For Invite)</Label>
                                <Input
                                    className="bg-white/5 border-white/10"
                                    placeholder="jane.doe@gmail.com"
                                    type="email"
                                    value={formData.personalEmail}
                                    onChange={e => setFormData({ ...formData, personalEmail: e.target.value })}
                                />
                                <p className="text-xs text-muted-foreground">
                                    An invitation link will be sent to this email to claim their account.
                                </p>
                            </div>
                        </CardContent>
                        <CardFooter className="justify-end">
                            <Button onClick={handleGenerate} disabled={!formData.firstName || !formData.lastName}>
                                Next: Generate ID <UserPlus className="ml-2 h-4 w-4" />
                            </Button>
                        </CardFooter>
                    </>
                )}

                {step === 2 && (
                    <>
                        <CardHeader>
                            <CardTitle>Identity Generation</CardTitle>
                            <CardDescription>Review the auto-generated Business Identity.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="bg-gradient-to-br from-indigo-900/50 to-purple-900/50 border border-indigo-500/30 rounded-xl p-6 text-center space-y-2">
                                <Building className="h-8 w-8 mx-auto text-indigo-400 mb-2" />
                                <h3 className="text-sm font-medium text-indigo-300 uppercase tracking-wider">Company Identity</h3>
                                <div className="text-4xl font-mono font-black text-white tracking-widest">
                                    {generatedId}
                                </div>
                                <p className="text-xs text-indigo-300">Auto-generated Employee ID</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                                    <span className="block text-muted-foreground text-xs">Linked Personal Account</span>
                                    <span className="font-medium flex items-center gap-2 mt-1">
                                        <Mail className="h-3 w-3" /> {formData.personalEmail}
                                    </span>
                                </div>
                                <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                                    <span className="block text-muted-foreground text-xs">Hierarchy Level</span>
                                    <span className="font-medium flex items-center gap-2 mt-1">
                                        <Shield className="h-3 w-3" /> Level {formData.hierarchyLevel}
                                    </span>
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter className="flex justify-between">
                            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                            <Button onClick={handleConfirmHire} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                                Confirm & Hire
                            </Button>
                        </CardFooter>
                    </>
                )}

                {step === 3 && (
                    <>
                        <CardContent className="pt-6 text-center space-y-6">
                            <div className="h-20 w-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
                                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-2xl font-bold text-white">Employee Onboarded!</h2>
                                <p className="text-muted-foreground">
                                    Identity <strong>{generatedId}</strong> has been created.
                                </p>
                            </div>

                            <div className="p-4 bg-white/5 rounded-lg border border-white/10 text-left space-y-2">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground">Business Login:</span>
                                    <div className="flex items-center gap-2">
                                        <code className="bg-black px-2 py-1 rounded text-white">{generatedId}</code>
                                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCopy}>
                                            <Copy className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground">Status:</span>
                                    <span className="text-emerald-400 flex items-center gap-1">
                                        <Mail className="h-3 w-3" /> Invite Sent
                                    </span>
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter className="justify-center">
                            <Button variant="outline" onClick={() => router.push('/dashboard/team')}>
                                Return to Team
                            </Button>
                        </CardFooter>
                    </>
                )}
            </Card>
        </div>
    )
}
