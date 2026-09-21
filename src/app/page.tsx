import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Triangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

/**
 * The front door.
 *
 * Delphi is a private control surface, not a product with a funnel, so the
 * root is a gate rather than a landing page: anyone already signed in goes
 * straight to mission control and never sees this.
 */
export default async function HomePage({
    searchParams,
}: {
    searchParams: Promise<{ code?: string; type?: string }>
}) {
    // Supabase rewrites a redirect target that is not in the project's allowed
    // list to the bare Site URL, silently — so a password-reset link can arrive
    // here carrying its code instead of at the callback. Forwarding it means
    // the flow works whether or not the allowlist was configured, rather than
    // dead-ending on a sign-in page for a password the person cannot remember.
    const { code, type } = await searchParams
    if (code) {
        const next = type === 'recovery' ? '/account/new-password' : '/dashboard/delphi'
        redirect(`/auth/callback?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`)
    }

    const supabase = await createClient()

    if (supabase) {
        const {
            data: { user },
        } = await supabase.auth.getUser()
        if (user) redirect('/dashboard/delphi')
    }

    return (
        <main className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0a] px-6 text-center">
            <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/20 text-primary">
                    <Triangle className="h-6 w-6 fill-current" />
                </div>
                <span className="text-3xl font-bold tracking-tight text-white">Delphi</span>
            </div>

            <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Your AI CEO. Stand up a department and Delphi hires the agents to run it,
                reporting back to you before anything reaches the outside world.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="font-semibold">
                    <Link href="/login">
                        Sign in <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                </Button>
                <Button asChild variant="outline">
                    <Link href="/login?mode=signup">Create an account</Link>
                </Button>
            </div>
        </main>
    )
}
