"use client"

import { useState } from "react"
import {
    Briefcase,
    Store,
    UtensilsCrossed,
    Check,
    ArrowRight,
    Users,
    CreditCard,
    Shield,
    Gem,
    LayoutGrid,
    ChevronRight,
    Search
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { completeOnboarding } from './actions'
import { TOOL_REGISTRY, ToolId } from "@/lib/types/tool-registry"

// Tier Definitions
const TIERS = [
    {
        id: 'free',
        name: 'Personal (Free)',
        price: 'Free',
        description: 'Essential tools for personal finance.',
        features: ['Transactions', 'Accounts', 'Basic Overview'],
        icon: Users,
        color: 'text-blue-400',
        allowedTools: ['overview', 'transactions', 'accounts']
    },
    {
        id: 'pro',
        name: 'Personal (Pro)',
        price: '$12/mo',
        description: 'Advanced insights and wealth tracking.',
        features: ['Net Worth', 'Budgeting', 'News Feed', 'Analytics'],
        icon: Gem,
        color: 'text-purple-400',
        allowedTools: ['overview', 'transactions', 'accounts', 'news', 'budget', 'analytics', 'net_worth']
    },
    {
        id: 'business',
        name: 'Business',
        price: 'Trial',
        description: 'Complete suite for freelancers and companies.',
        features: ['Invoicing', 'Expenses', 'POS & Inventory', 'Team Mgmt'],
        icon: Briefcase,
        color: 'text-emerald-400',
        allowedTools: ['overview', 'transactions', 'news', 'invoices', 'vendor_analysis', 'team', 'expenses', 'taxes', 'pos', 'inventory', 'shifts', 'menu', 'kitchen', 'jobs', 'time_tracking']
    }
]

export default function OnboardingPage() {
    const [step, setStep] = useState<1 | 2>(1)
    const [selectedTier, setSelectedTier] = useState<string | null>(null)
    const [selectedTools, setSelectedTools] = useState<ToolId[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [searchTools, setSearchTools] = useState('')

    // Computed
    const currentTier = TIERS.find(t => t.id === selectedTier)

    const handleTierSelect = (tierId: string) => {
        setSelectedTier(tierId)
        // Auto-select "Recommended" tools for that tier
        const tier = TIERS.find(t => t.id === tierId)
        if (tier) {
            // Default select first 5 tools just as a starter
            setSelectedTools(tier.allowedTools.slice(0, 5) as ToolId[])
        }
    }

    const toggleTool = (toolId: ToolId) => {
        if (selectedTools.includes(toolId)) {
            setSelectedTools(prev => prev.filter(id => id !== toolId))
        } else {
            setSelectedTools(prev => [...prev, toolId])
        }
    }

    const handleContinue = async () => {
        if (step === 1 && selectedTier) {
            setStep(2)
            window.scrollTo(0, 0)
            return
        }

        if (step === 2) {
            setIsLoading(true)
            // Save logic
            // Ideally passing the full config, but for now we map back to the "Industry" string expected by the server action
            // Or we update server action. 
            // For this prototype, we'll map 'business' -> 'freelance' (default) if they picked invoice tools, or 'retail' if POS.
            // This is a simplification for the existing backend action.

            let industry = 'personal'
            if (selectedTier === 'business') {
                if (selectedTools.includes('pos')) industry = 'retail'
                else if (selectedTools.includes('kitchen')) industry = 'restaurant'
                else industry = 'freelance'
            }

            await completeOnboarding(industry)
        }
    }

    // --- STEP 1: TIER SELECTION ---
    if (step === 1) {
        return (
            <div className="min-h-screen w-full bg-[#0a0a0a] flex flex-col items-center justify-center p-6 text-white">
                <div className="max-w-5xl w-full space-y-12">
                    <div className="text-center space-y-4">
                        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
                            Choose your plan
                        </h1>
                        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                            Select the workspace type that fits your needs. You can change this later.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8">
                        {TIERS.map(tier => {
                            const Icon = tier.icon
                            const isSelected = selectedTier === tier.id
                            return (
                                <Card
                                    key={tier.id}
                                    onClick={() => handleTierSelect(tier.id)}
                                    className={cn(
                                        "relative flex flex-col p-8 cursor-pointer transition-all duration-300 border-white/10 bg-white/5 hover:bg-white/10 hover:scale-[1.02]",
                                        isSelected && "border-primary ring-2 ring-primary bg-primary/10 scale-[1.02]"
                                    )}
                                >
                                    {isSelected && (
                                        <div className="absolute top-4 right-4 h-6 w-6 rounded-full bg-primary flex items-center justify-center animate-in fade-in zoom-in">
                                            <Check className="h-4 w-4 text-white" />
                                        </div>
                                    )}

                                    <div className={cn("h-14 w-14 rounded-2xl bg-white/5 flex items-center justify-center mb-6", tier.color)}>
                                        <Icon className="h-7 w-7" />
                                    </div>

                                    <div className="mb-6">
                                        <h3 className="font-bold text-2xl mb-1">{tier.name}</h3>
                                        <div className="text-lg font-medium text-muted-foreground">{tier.price}</div>
                                    </div>

                                    <div className="space-y-4 flex-1">
                                        <p className="text-sm text-gray-400">{tier.description}</p>
                                        <ul className="space-y-3">
                                            {tier.features.map(feat => (
                                                <li key={feat} className="flex items-center gap-3 text-sm">
                                                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                                                    {feat}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </Card>
                            )
                        })}
                    </div>

                    <div className="flex justify-center">
                        <Button
                            size="lg"
                            className="bg-white text-black hover:bg-gray-200 text-lg px-12 h-14 rounded-full"
                            disabled={!selectedTier}
                            onClick={handleContinue}
                        >
                            Review & Customize <ArrowRight className="ml-2 h-5 w-5" />
                        </Button>
                    </div>
                </div>
            </div>
        )
    }

    // --- STEP 2: TOOL SELECTION ---
    return (
        <div className="min-h-screen w-full bg-[#0a0a0a] flex flex-col items-center p-6 text-white">
            <div className="max-w-5xl w-full space-y-8">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <button onClick={() => setStep(1)} className="text-muted-foreground hover:text-white flex items-center gap-2">
                        ← Back to Plans
                    </button>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="text-primary font-medium">{currentTier?.name}</span>
                        <span>/</span>
                        <span>Customize Tools</span>
                    </div>
                </div>

                <div className="text-center space-y-4">
                    <h1 className="text-3xl font-bold tracking-tight">
                        Customize your Sidebar
                    </h1>
                    <p className="text-muted-foreground">
                        Select the tools you want to enable. You can disable clutter at any time.
                    </p>
                </div>

                {/* Filter */}
                <div className="relative max-w-md mx-auto">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search tools..."
                        className="pl-10 bg-white/5 border-white/10 rounded-full"
                        value={searchTools}
                        onChange={(e) => setSearchTools(e.target.value)}
                    />
                </div>

                {/* Tool Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {currentTier?.allowedTools
                        .filter(t => TOOL_REGISTRY[t as ToolId].label.toLowerCase().includes(searchTools.toLowerCase()))
                        .map(toolId => {
                            const def = TOOL_REGISTRY[toolId as ToolId]
                            const isSelected = selectedTools.includes(toolId as ToolId)
                            const Icon = def.icon

                            return (
                                <div
                                    key={toolId}
                                    onClick={() => toggleTool(toolId as ToolId)}
                                    className={cn(
                                        "group flex items-start gap-4 p-4 rounded-xl border border-white/5 bg-white/5 cursor-pointer transition-all hover:bg-white/10",
                                        isSelected && "border-primary/50 bg-primary/5"
                                    )}
                                >
                                    <div className={cn(
                                        "h-10 w-10 rounded-lg flex items-center justify-center transition-colors",
                                        isSelected ? "bg-primary text-white" : "bg-white/10 text-muted-foreground group-hover:text-white"
                                    )}>
                                        {isSelected ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                                    </div>
                                    <div className="flex-1">
                                        <div className="font-semibold text-white mb-1 flex justify-between">
                                            {def.label}
                                        </div>
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                            {def.description}
                                        </p>
                                    </div>
                                </div>
                            )
                        })
                    }
                </div>

                {/* Footer Footer */}
                <div className="fixed bottom-0 left-0 right-0 p-6 bg-black/80 backdrop-blur-xl border-t border-white/10 flex justify-center z-50">
                    <div className="max-w-5xl w-full flex items-center justify-between">
                        <div className="text-sm">
                            <span className="font-bold text-white">{selectedTools.length}</span> tools selected
                        </div>
                        <Button
                            size="lg"
                            disabled={isLoading || selectedTools.length === 0}
                            onClick={handleContinue}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full px-8"
                        >
                            {isLoading ? 'Setting up Workspace...' : 'Complete Setup'}
                        </Button>
                    </div>
                </div>
                <div className="h-24" /> {/* Spacer for fixed footer */}
            </div>
        </div>
    )
}
