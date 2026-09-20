"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { WorldState } from './types'

export interface Pulse {
    busy: number
    idle: number
    blocked: number
    openTasks: number
    doneTasks: number
}

export interface StorageStatus {
    id: string
    label: string
    configured: boolean
    missing: string | null
}

async function post<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
    return json as T
}

/**
 * Drives the world from the browser.
 *
 * Two clocks: a fast one that steps animation, and a slow one that lets agents
 * take model turns. They are separate because a model turn takes seconds and
 * must not stall the office.
 */
export function useWorld() {
    const [state, setState] = useState<WorldState | null>(null)
    const [pulse, setPulse] = useState<Pulse | null>(null)
    const [live, setLive] = useState(false)
    const [storage, setStorage] = useState<StorageStatus[]>([])
    const [error, setError] = useState<string | null>(null)
    const [thinking, setThinking] = useState(false)

    const tickBusy = useRef(false)
    const workBusy = useRef(false)
    const running = useRef(true)

    const apply = useCallback((payload: { state?: WorldState; pulse?: Pulse }) => {
        if (payload.state) setState(payload.state)
        if (payload.pulse) setPulse(payload.pulse)
    }, [])

    const refresh = useCallback(async () => {
        try {
            const res = await fetch('/api/world/state', { cache: 'no-store' })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error ?? 'Failed to load world')
            setState(json.state)
            setPulse(json.pulse)
            setLive(json.live)
            setStorage(json.storage ?? [])
            setError(null)
        } catch (err) {
            setError((err as Error).message)
        }
    }, [])

    useEffect(() => {
        refresh()
        return () => {
            running.current = false
        }
    }, [refresh])

    // Animation clock.
    useEffect(() => {
        const hz = state?.settings.tickHz ?? 2
        const interval = setInterval(async () => {
            if (tickBusy.current || !running.current) return
            tickBusy.current = true
            try {
                apply(await post('/api/world/tick', { steps: 1 }))
            } catch {
                /* a dropped frame is not worth surfacing */
            } finally {
                tickBusy.current = false
            }
        }, 1000 / hz)
        return () => clearInterval(interval)
    }, [state?.settings.tickHz, apply])

    // Work clock — agents think here.
    useEffect(() => {
        const interval = setInterval(async () => {
            if (workBusy.current || !running.current) return
            if (state?.settings.paused) return
            workBusy.current = true
            try {
                apply(await post('/api/world/tick', { steps: 1, work: true }))
            } catch (err) {
                setError((err as Error).message)
            } finally {
                workBusy.current = false
            }
        }, 7000)
        return () => clearInterval(interval)
    }, [state?.settings.paused, apply])

    const sendToCeo = useCallback(
        async (message: string) => {
            setThinking(true)
            setError(null)
            try {
                apply(await post('/api/world/chat', { message }))
            } catch (err) {
                setError((err as Error).message)
            } finally {
                setThinking(false)
            }
        },
        [apply]
    )

    const control = useCallback(
        async (body: Record<string, unknown>) => {
            try {
                const res = await post<{ state: WorldState; error?: string }>('/api/world/control', body)
                apply(res)
                if (res.error) setError(res.error)
                return res
            } catch (err) {
                setError((err as Error).message)
                return null
            }
        },
        [apply]
    )

    const connections = useCallback(
        async (body: Record<string, unknown>) => {
            try {
                apply(await post('/api/world/connections', body))
            } catch (err) {
                setError((err as Error).message)
            }
        },
        [apply]
    )

    const upload = useCallback(
        async (file: File, companyId: string | null) => {
            const form = new FormData()
            form.append('file', file)
            if (companyId) form.append('companyId', companyId)
            try {
                const res = await fetch('/api/world/files', { method: 'POST', body: form })
                const json = await res.json()
                if (!res.ok) throw new Error(json.error ?? 'Upload failed')
                apply(json)
            } catch (err) {
                setError((err as Error).message)
            }
        },
        [apply]
    )

    return {
        state,
        pulse,
        live,
        storage,
        error,
        thinking,
        refresh,
        sendToCeo,
        control,
        connections,
        upload,
        clearError: () => setError(null),
    }
}
