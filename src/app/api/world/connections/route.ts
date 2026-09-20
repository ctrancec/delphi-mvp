import { NextResponse } from 'next/server'
import { withWorld } from '@/lib/world/store'
import { resolveOwnerKey } from '@/lib/world/owner'
import { connectConnection, requestConnection, unblockWaitingOn } from '@/lib/world/actions'
import { CONNECTION_CATALOG, catalogEntry } from '@/lib/world/connections'

export const dynamic = 'force-dynamic'

export async function GET() {
    return NextResponse.json({ catalog: CONNECTION_CATALOG })
}

/**
 * Connections are the one thing agents cannot do for themselves. Secrets are
 * never stored in the world document — only the *name* of the env var that
 * holds them, so the world is safe to sync, export and inspect.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json()
        const ownerKey = await resolveOwnerKey()

        const { state, result } = await withWorld(ownerKey, (world) => {
            if (body.action === 'add') {
                const entry = catalogEntry(body.provider)
                const { connection } = requestConnection(world, {
                    companyId: body.companyId ?? null,
                    provider: body.provider,
                    label: body.label ?? entry?.label ?? body.provider,
                    reason: body.reason ?? entry?.hint ?? 'Added by the CHO.',
                    fields: entry?.fields ?? body.fields,
                    requestedBy: 'cho',
                })
                return { connection }
            }

            if (body.action === 'connect') {
                const message = connectConnection(world, body.connectionId, {
                    secretRef: body.secretRef ?? null,
                    config: body.config ?? {},
                })
                const conn = world.connections.find((c) => c.id === body.connectionId)
                if (conn) unblockWaitingOn(world, conn.provider)
                return { message }
            }

            if (body.action === 'remove') {
                const idx = world.connections.findIndex((c) => c.id === body.connectionId)
                if (idx >= 0) world.connections.splice(idx, 1)
                return { message: 'Connection removed.' }
            }

            return { error: `Unknown action "${body.action}".` }
        })

        return NextResponse.json({ state, ...result })
    } catch (err) {
        console.error('[world] connections failed:', err)
        return NextResponse.json({ error: (err as Error).message }, { status: 500 })
    }
}
