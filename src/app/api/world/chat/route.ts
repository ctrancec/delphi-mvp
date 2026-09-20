import { NextResponse } from 'next/server'
import { withWorld } from '@/lib/world/store'
import { resolveOwnerKey } from '@/lib/world/owner'
import { runCeoTurn } from '@/lib/world/agent'
import { CEO_CHANNEL, pushChat } from '@/lib/world/actions'
import { worldPulse } from '@/lib/world/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** The CHO's direct line to the CEO agent. */
export async function POST(req: Request) {
    try {
        const { message } = await req.json()
        if (typeof message !== 'string' || !message.trim()) {
            return NextResponse.json({ error: 'message is required' }, { status: 400 })
        }

        const ownerKey = await resolveOwnerKey()
        const { state, result } = await withWorld(ownerKey, async (world) => {
            pushChat(world, {
                channel: CEO_CHANNEL,
                role: 'human',
                authorId: 'cho',
                content: message.trim(),
            })
            return runCeoTurn(world, message.trim())
        })

        return NextResponse.json({ state, turn: result, pulse: worldPulse(state) })
    } catch (err) {
        console.error('[world] chat failed:', err)
        return NextResponse.json({ error: (err as Error).message }, { status: 500 })
    }
}
