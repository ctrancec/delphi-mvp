import { NextResponse } from 'next/server'
import { withWorld } from '@/lib/world/store'
import { resolveOwnerKey } from '@/lib/world/owner'
import { runAgentTurns, stepWorld, worldPulse } from '@/lib/world/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Advances the world. `steps` are cheap animation frames; `work: true`
 * additionally gives agents model turns, which is slow — the client calls that
 * on a much lower cadence.
 */
export async function POST(req: Request) {
    try {
        const { steps = 1, work = false, maxTurns } = await req.json().catch(() => ({}))
        const ownerKey = await resolveOwnerKey()

        const { state, result } = await withWorld(ownerKey, async (world) => {
            for (let i = 0; i < Math.min(Number(steps) || 1, 10); i++) stepWorld(world)
            if (!work) return { ran: 0, skipped: null }
            return runAgentTurns(world, maxTurns ? Number(maxTurns) : undefined)
        })

        return NextResponse.json({ state, work: result, pulse: worldPulse(state) })
    } catch (err) {
        console.error('[world] tick failed:', err)
        return NextResponse.json({ error: (err as Error).message }, { status: 500 })
    }
}
