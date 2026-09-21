'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react'
import { createDepartmentAction } from '@/lib/delphi/actions'

/** Charters that actually staff well — specific about output and cadence. */
const EXAMPLES = [
    {
        name: 'News & Market Research',
        charter:
            'Every weekday morning, brief me on global events and market moves that affect my positions. Lead with what changed overnight, anchor claims to real figures, and flag anything only one outlet is reporting.',
        cadence: '0 7 * * 1-5',
    },
    {
        name: 'Social Media',
        charter:
            'Turn my gaming clips into short vertical videos with captions, and draft platform-specific posts for them. Never publish anything without my approval.',
        cadence: '',
    },
    {
        name: 'Global News',
        charter:
            'Monitor world events continuously across regions and languages. Translate anything significant into English and tell me how well corroborated it is before I act on it.',
        cadence: '0 */6 * * *',
    },
]

export default function NewDepartmentPage() {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const [form, setForm] = useState({ name: '', charter: '', budgetUsd: '5.00', cadenceCron: '' })

    const submit = () => {
        setError(null)
        startTransition(async () => {
            const res = await createDepartmentAction({
                name: form.name,
                charter: form.charter,
                budgetUsd: Number(form.budgetUsd) || 5,
                cadenceCron: form.cadenceCron || undefined,
            })
            if (!res.ok) {
                setError(res.error ?? 'Something went wrong.')
                return
            }
            router.push(`/dashboard/delphi/departments/${res.data!.id}`)
        })
    }

    return (
        <div className="max-w-2xl space-y-6">
            <Link
                href="/dashboard/delphi"
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white"
            >
                <ArrowLeft className="h-4 w-4" /> Delphi
            </Link>

            <div>
                <h1 className="text-2xl font-bold tracking-tight">New department</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Describe what you want done. Delphi reads this to decide who to hire, so be specific
                    about the output you expect.
                </p>
            </div>

            <Card className="bg-black/40 border-white/10">
                <CardContent className="pt-6 space-y-5">
                    <div className="space-y-2">
                        <Label htmlFor="name">Name</Label>
                        <Input
                            id="name"
                            placeholder="News &amp; Market Research"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            className="bg-black/40 border-white/10"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="charter">Charter</Label>
                        <Textarea
                            id="charter"
                            rows={5}
                            placeholder="Every weekday morning, brief me on…"
                            value={form.charter}
                            onChange={(e) => setForm({ ...form, charter: e.target.value })}
                            className="bg-black/40 border-white/10 resize-none"
                        />
                        <p className="text-xs text-muted-foreground">
                            What the team delivers, how often, and what &ldquo;good&rdquo; looks like.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="budget">Budget (USD)</Label>
                            <Input
                                id="budget"
                                type="number"
                                step="0.50"
                                min="0.01"
                                value={form.budgetUsd}
                                onChange={(e) => setForm({ ...form, budgetUsd: e.target.value })}
                                className="bg-black/40 border-white/10"
                            />
                            <p className="text-xs text-muted-foreground">Work halts when this is spent.</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="cadence">Cadence (optional)</Label>
                            <Input
                                id="cadence"
                                placeholder="0 7 * * 1-5"
                                value={form.cadenceCron}
                                onChange={(e) => setForm({ ...form, cadenceCron: e.target.value })}
                                className="bg-black/40 border-white/10 font-mono text-sm"
                            />
                            <p className="text-xs text-muted-foreground">Cron. Blank means on demand.</p>
                        </div>
                    </div>

                    {error && (
                        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                            {error}
                        </div>
                    )}

                    <Button onClick={submit} disabled={pending} className="w-full">
                        {pending ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating…
                            </>
                        ) : (
                            <>
                                <Sparkles className="h-4 w-4 mr-2" /> Create &amp; ask Delphi to staff it
                            </>
                        )}
                    </Button>
                </CardContent>
            </Card>

            <Card className="bg-black/20 border-white/5">
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Start from an example</CardTitle>
                    <CardDescription className="text-xs">
                        These staff well because they say what the output is.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {EXAMPLES.map((ex) => (
                        <button
                            key={ex.name}
                            type="button"
                            onClick={() =>
                                setForm({ ...form, name: ex.name, charter: ex.charter, cadenceCron: ex.cadence })
                            }
                            className="w-full text-left p-3 rounded-lg border border-white/5 hover:border-white/20 hover:bg-white/5 transition-colors"
                        >
                            <div className="text-sm font-medium">{ex.name}</div>
                            <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{ex.charter}</div>
                        </button>
                    ))}
                </CardContent>
            </Card>
        </div>
    )
}
