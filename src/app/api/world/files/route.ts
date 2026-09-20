import { NextResponse } from 'next/server'
import { withWorld, readWorld } from '@/lib/world/store'
import { resolveOwnerKey } from '@/lib/world/owner'
import { getStorageProvider } from '@/lib/world/storage'
import { logEvent } from '@/lib/world/actions'
import { id } from '@/lib/world/ids'
import { FileRef } from '@/lib/world/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const TEXTUAL = /^(text\/|application\/(json|xml|yaml|sql|javascript|typescript))/

/** Download a file the CHO or an agent put in the drive. */
export async function GET(req: Request) {
    const url = new URL(req.url)
    const fileId = url.searchParams.get('fileId')

    const ownerKey = await resolveOwnerKey()
    const state = await readWorld(ownerKey)

    if (!fileId) {
        const companyId = url.searchParams.get('companyId')
        return NextResponse.json({
            files: state.files.filter((f) => (companyId ? f.companyId === companyId : true)),
        })
    }

    const ref = state.files.find((f) => f.id === fileId)
    if (!ref) return NextResponse.json({ error: 'No such file' }, { status: 404 })

    const provider = getStorageProvider(ref.provider)
    const blob = await provider.get(ref.key)
    if (!blob) return NextResponse.json({ error: 'File is missing from storage' }, { status: 404 })

    return new NextResponse(new Uint8Array(blob.data), {
        headers: {
            'Content-Type': ref.mime,
            'Content-Disposition': `attachment; filename="${ref.name.replace(/"/g, '')}"`,
        },
    })
}

/** Upload: the CHO hands a file to a project's drive. */
export async function POST(req: Request) {
    try {
        const form = await req.formData()
        const file = form.get('file')
        const companyId = (form.get('companyId') as string | null) || null

        if (!(file instanceof File)) {
            return NextResponse.json({ error: 'file is required' }, { status: 400 })
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            return NextResponse.json(
                { error: `File is larger than the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit.` },
                { status: 413 }
            )
        }

        const data = Buffer.from(await file.arrayBuffer())
        const mime = file.type || 'application/octet-stream'
        const ownerKey = await resolveOwnerKey()

        const { state, result } = await withWorld(ownerKey, async (world) => {
            const provider = getStorageProvider(world.settings.storageProvider)
            const stored = await provider.put({ companyId, name: file.name, mime, data })

            const ref: FileRef = {
                id: id('file'),
                companyId,
                name: file.name,
                mime,
                size: data.byteLength,
                provider: provider.id,
                key: stored.key,
                url: stored.url,
                uploadedBy: 'cho',
                createdAt: Date.now(),
                summary: TEXTUAL.test(mime)
                    ? data.toString('utf-8').slice(0, 200).replace(/\s+/g, ' ')
                    : null,
            }
            world.files.push(ref)
            logEvent(world, {
                type: 'file.uploaded',
                actorId: null,
                companyId,
                text: `The CHO uploaded ${file.name} to the ${provider.label} drive.`,
                meta: { fileId: ref.id },
            })
            return { file: ref, provider: provider.label }
        })

        return NextResponse.json({ state, ...result })
    } catch (err) {
        console.error('[world] upload failed:', err)
        return NextResponse.json({ error: (err as Error).message }, { status: 500 })
    }
}
