import { NextResponse } from 'next/server'
import { readWorld } from '@/lib/world/store'
import { resolveOwnerKey } from '@/lib/world/owner'
import { isLiveMode } from '@/lib/world/config'
import { describeProviders } from '@/lib/world/storage'
import { worldPulse } from '@/lib/world/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
    try {
        const ownerKey = await resolveOwnerKey()
        const state = await readWorld(ownerKey)
        return NextResponse.json({
            state,
            live: isLiveMode(),
            pulse: worldPulse(state),
            storage: describeProviders(),
        })
    } catch (err) {
        console.error('[world] state failed:', err)
        return NextResponse.json({ error: (err as Error).message }, { status: 500 })
    }
}
