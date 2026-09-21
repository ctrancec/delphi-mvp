'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Sparkles, Check, UserPlus, Users } from 'lucide-react'
import { proposeHiringAction, approvePlanAction } from '@/lib/delphi/actions'

export interface HiredAgent {
    seq: number
    name: string
    title: string
    skills: string[]
    costTier: number
    score: number
    rationale: string
    isNewHire: boolean
    taskTitle: string
    objective: string
    status: string
}

const TIER_LABEL: Record<number, string> = { 1: '$', 2: '$$', 3: '$$$' }

/**
 * Delphi's staffing proposal, and the gate in front of it.
 *
 * Nothing runs until the CHO approves. That gate is the whole point: the CHO
 * sees who was hired, why, and what it will cost before any money is spent.
 */
export function HiringPanel({
    departmentId,
    team,
    status,
    approved,
}: {
    departmentId: string
    team: HiredAgent[]
    status: string
    approved: boolean
}) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
        setError(null)
        startTransition(async () => {
            const res = await fn()
            if (!res.ok) setError(res.error ?? 'Something went wrong.')
            router.refresh()
        })
    }

    if (team.length === 0) {
        return (
            <Card className="bg-black/40 border-white/10 border-dashed">
                <CardContent className="py-12 text-center space-y-4">
                    <Users className="h-10 w-10 mx-auto text-muted-foreground/40" />
                    <div className="space-y-1">
                        <h3 className="font-semibold">No team yet</h3>
                        <p className="text-sm text-muted-foreground max-w-md mx-auto">
                            Delphi will read the charter, shortlist the roster, and propose who should do
                            what — and draft a new agent if nothing fits.
                        </p>
                    </div>
                    {error && <p className="text-sm text-red-400">{error}</p>}
                    <Button onClick={() => run(() => proposeHiringAction(departmentId))} disabled={pending}>
                        {pending ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Delphi is staffing…
                            </>
                        ) : (
                            <>
                                <Sparkles className="h-4 w-4 mr-2" /> Ask Delphi to staff this
                            </>
                        )}
                    </Button>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                    {approved ? 'The team' : 'Delphi proposes'}
                    <span className="text-muted-foreground font-normal text-sm ml-2">
                        {team.length} agents
                    </span>
                </h2>
                {!approved && (
                    <Button
                        onClick={() => run(() => approvePlanAction(departmentId))}
                        disabled={pending || status !== 'awaiting_approval'}
                    >
                        {pending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                            <Check className="h-4 w-4 mr-2" />
                        )}
                        Approve &amp; launch
                    </Button>
                )}
            </div>

            {error && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                    {error}
                </div>
            )}

            <AnimatePresence>
                <div className="space-y-3">
                    {team.map((m, i) => (
                        <motion.div
                            key={m.seq}
                            layoutId={`agent-${m.seq}`}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.06, duration: 0.25 }}
                        >
                            <Card className="bg-black/40 border-white/10">
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-start gap-3 min-w-0">
                                            <div className="h-9 w-9 shrink-0 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xs font-semibold tabular-nums">
                                                {m.seq}
                                            </div>
                                            <div className="min-w-0">
                                                <CardTitle className="text-base leading-tight truncate">
                                                    {m.name}
                                                </CardTitle>
                                                <p className="text-xs text-muted-foreground mt-0.5">{m.title}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {m.isNewHire && (
                                                <Badge
                                                    variant="outline"
                                                    className="text-amber-400 border-amber-400/30 gap-1"
                                                >
                                                    <UserPlus className="h-3 w-3" /> new hire
                                                </Badge>
                                            )}
                                            <span
                                                className="text-xs text-muted-foreground font-mono"
                                                title={`Cost tier ${m.costTier}`}
                                            >
                                                {TIER_LABEL[m.costTier] ?? '$'}
                                            </span>
                                        </div>
                                    </div>
                                </CardHeader>

                                <CardContent className="space-y-3 pt-0">
                                    <div>
                                        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                                            {m.taskTitle}
                                        </div>
                                        <p className="text-sm">{m.objective}</p>
                                    </div>

                                    <p className="text-sm text-muted-foreground italic">{m.rationale}</p>

                                    <div className="flex items-center gap-3">
                                        <div className="h-1.5 flex-1 rounded-full bg-white/5 overflow-hidden">
                                            <motion.div
                                                className="h-full bg-emerald-400/70"
                                                initial={{ width: 0 }}
                                                animate={{ width: `${m.score * 100}%` }}
                                                transition={{ delay: 0.2 + i * 0.06, duration: 0.5 }}
                                            />
                                        </div>
                                        <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                                            {m.score.toFixed(2)}
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>
                    ))}
                </div>
            </AnimatePresence>

            {!approved && (
                <p className="text-xs text-muted-foreground text-center">
                    Nothing runs and nothing is spent until you approve.
                </p>
            )}
        </div>
    )
}
