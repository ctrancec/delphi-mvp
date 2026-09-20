"use client"

import React, { useEffect, useMemo, useRef } from 'react'
import { Agent, Floor, TileKind, tileAt } from '@/lib/world/types'

/** Logical tile size in CSS pixels before zoom. */
const TILE = 24
/** Sprites are drawn on an 8×8 sub-grid per tile. */
const P = TILE / 8

type Facing = 'down' | 'up' | 'left' | 'right'

interface Rendered {
    x: number
    y: number
    facing: Facing
    step: number
}

interface Props {
    floor: Floor
    agents: Agent[]
    selectedId: string | null
    onSelect: (agentId: string | null) => void
    zoom: number
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
    ctx.fillStyle = color
    ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h))
}

function shade(hex: string, amount: number): string {
    const n = parseInt(hex.replace('#', ''), 16)
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount))
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount))
    const b = Math.max(0, Math.min(255, (n & 255) + amount))
    return `rgb(${r},${g},${b})`
}

function drawTile(
    ctx: CanvasRenderingContext2D,
    kind: TileKind,
    tx: number,
    ty: number,
    palette: string,
    t: number
) {
    const x = tx * TILE
    const y = ty * TILE

    // Every tile sits on a floor base so walls have something to stand on.
    const parity = (tx + ty) % 2 === 0
    px(ctx, x, y, TILE, TILE, parity ? '#1c1c22' : '#191920')

    switch (kind) {
        case 'void':
            px(ctx, x, y, TILE, TILE, '#0a0a0c')
            break

        case 'floor':
            px(ctx, x, y, TILE, 1, '#22222b')
            px(ctx, x, y, 1, TILE, '#22222b')
            break

        case 'rug':
            px(ctx, x, y, TILE, TILE, shade(palette, -120))
            px(ctx, x + P, y + P, TILE - 2 * P, TILE - 2 * P, shade(palette, -100))
            break

        case 'wall':
            px(ctx, x, y, TILE, TILE, '#2b2b36')
            px(ctx, x, y, TILE, P, '#3a3a4a')
            px(ctx, x, y + TILE - P, TILE, P, '#141418')
            break

        case 'door':
            px(ctx, x, y, TILE, TILE, '#2b2b36')
            px(ctx, x + P, y + P, TILE - 2 * P, TILE - P, '#4a3b2a')
            px(ctx, x + TILE - 3 * P, y + TILE / 2, P, P, '#e0c068')
            break

        case 'desk': {
            // Desktop surface
            px(ctx, x, y + 2 * P, TILE, TILE - 3 * P, '#6b4a2f')
            px(ctx, x, y + 2 * P, TILE, P, '#8a6340')
            px(ctx, x, y + TILE - P, TILE, P, '#3a2718')
            // Monitor
            px(ctx, x + 2 * P, y, 4 * P, 3 * P, '#111116')
            const glow = Math.sin(t / 420 + tx * 1.7 + ty) > 0 ? shade(palette, 40) : shade(palette, 0)
            px(ctx, x + 2.5 * P, y + 0.5 * P, 3 * P, 2 * P, glow)
            // Keyboard
            px(ctx, x + 2 * P, y + 5 * P, 4 * P, P, '#cfcfd8')
            break
        }

        case 'plant':
            px(ctx, x + 2.5 * P, y + 5 * P, 3 * P, 3 * P, '#7a4a2a')
            px(ctx, x + 2 * P, y + 2 * P, 4 * P, 3 * P, '#2f7d4f')
            px(ctx, x + 3 * P, y + P, 2 * P, 2 * P, '#3f9d63')
            break

        case 'whiteboard':
            px(ctx, x, y + P, TILE, TILE - 2 * P, '#e9e9ef')
            px(ctx, x + P, y + 2 * P, 5 * P, P, '#8b5cf6')
            px(ctx, x + P, y + 4 * P, 3 * P, P, '#38bdf8')
            px(ctx, x, y + TILE - 2 * P, TILE, P, '#9a9aa8')
            break

        case 'server': {
            px(ctx, x + P, y, 6 * P, TILE - P, '#15151b')
            for (let i = 0; i < 5; i++) {
                const on = Math.sin(t / 240 + i * 2.1 + tx) > 0.2
                px(ctx, x + 2 * P, y + (1.5 + i * 1.2) * P, P, P, on ? '#4ade80' : '#1f3d2a')
                px(ctx, x + 4 * P, y + (1.5 + i * 1.2) * P, 2 * P, P / 2, '#2a2a34')
            }
            break
        }

        case 'coffee':
            px(ctx, x + P, y + P, 6 * P, 6 * P, '#3a3a46')
            px(ctx, x + 2 * P, y + 2 * P, 4 * P, 2 * P, '#1a1a22')
            px(ctx, x + 3 * P, y + 5 * P, 2 * P, 1.5 * P, '#d8d8e2')
            // Steam
            if (Math.sin(t / 300) > 0) px(ctx, x + 3.5 * P, y, P, P, 'rgba(255,255,255,0.25)')
            break
    }
}

function drawAgent(
    ctx: CanvasRenderingContext2D,
    agent: Agent,
    r: Rendered,
    selected: boolean,
    t: number
) {
    const cx = r.x * TILE
    const cy = r.y * TILE
    const walking = agent.status === 'walking'
    const bob = walking ? (Math.floor(t / 130) % 2 === 0 ? 0 : -P / 2) : 0
    const { skin, hair, outfit, accent } = agent.appearance

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.beginPath()
    ctx.ellipse(cx + TILE / 2, cy + TILE - 2, TILE * 0.3, TILE * 0.14, 0, 0, Math.PI * 2)
    ctx.fill()

    if (selected) {
        ctx.strokeStyle = accent
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.ellipse(cx + TILE / 2, cy + TILE - 2, TILE * 0.42, TILE * 0.2, 0, 0, Math.PI * 2)
        ctx.stroke()
    }

    // Sprite is 8 wide × 12 tall sub-pixels, standing on the bottom of the tile.
    const ox = cx + P
    const oy = cy + TILE - 12 * P + bob

    // Legs
    const stride = walking && Math.floor(t / 130) % 2 === 0 ? P : 0
    px(ctx, ox + 1.5 * P, oy + 9 * P, 1.5 * P, 3 * P - stride, '#26262f')
    px(ctx, ox + 4 * P, oy + 9 * P, 1.5 * P, 3 * P - (P - stride), '#26262f')

    // Torso + arms
    px(ctx, ox + P, oy + 5 * P, 5 * P, 4 * P, outfit)
    px(ctx, ox, oy + 5 * P, P, 3 * P, shade(outfit, -20))
    px(ctx, ox + 6 * P, oy + 5 * P, P, 3 * P, shade(outfit, -20))
    px(ctx, ox + 2.5 * P, oy + 5 * P, 2 * P, P, accent) // collar

    // Head
    px(ctx, ox + 1.5 * P, oy + P, 4 * P, 4 * P, skin)
    px(ctx, ox + 1.5 * P, oy, 4 * P, 1.5 * P, hair)

    // Face, only when we can see it
    if (r.facing === 'down') {
        px(ctx, ox + 2.5 * P, oy + 2.5 * P, P / 2, P / 2, '#14141a')
        px(ctx, ox + 4 * P, oy + 2.5 * P, P / 2, P / 2, '#14141a')
    } else if (r.facing === 'left') {
        px(ctx, ox + 2 * P, oy + 2.5 * P, P / 2, P / 2, '#14141a')
        px(ctx, ox + 1.5 * P, oy + P, P, 4 * P, hair)
    } else if (r.facing === 'right') {
        px(ctx, ox + 4.5 * P, oy + 2.5 * P, P / 2, P / 2, '#14141a')
        px(ctx, ox + 4.5 * P, oy + P, P, 4 * P, hair)
    } else {
        px(ctx, ox + 1.5 * P, oy + P, 4 * P, 2.5 * P, hair)
    }

    // Status pip
    const statusColor: Record<string, string> = {
        thinking: '#facc15',
        working: '#4ade80',
        walking: '#38bdf8',
        talking: '#f472b6',
        blocked: '#ef4444',
        idle: '#71717a',
        offline: '#3f3f46',
    }
    px(ctx, ox + 6 * P, oy, 2 * P, 2 * P, statusColor[agent.status] ?? '#71717a')

    // Thinking dots
    if (agent.status === 'thinking') {
        const n = Math.floor(t / 300) % 3
        for (let i = 0; i <= n; i++) {
            px(ctx, ox + (1 + i * 1.6) * P, oy - 2 * P, P, P, '#facc15')
        }
    }

    // Name plate
    ctx.font = `${Math.round(P * 3)}px ui-monospace, monospace`
    ctx.textAlign = 'center'
    const label = agent.name
    const w = ctx.measureText(label).width + 6
    ctx.fillStyle = 'rgba(8,8,12,0.75)'
    ctx.fillRect(cx + TILE / 2 - w / 2, cy + TILE - 1, w, P * 4)
    ctx.fillStyle = selected ? accent : '#d4d4d8'
    ctx.fillText(label, cx + TILE / 2, cy + TILE + P * 3)
}

function drawBubble(ctx: CanvasRenderingContext2D, agent: Agent, r: Rendered) {
    if (!agent.bubble) return
    const words = agent.bubble.split(' ')
    const lines: string[] = []
    let line = ''
    for (const word of words) {
        if ((line + ' ' + word).trim().length > 22) {
            lines.push(line.trim())
            line = word
            if (lines.length === 3) break
        } else {
            line += ` ${word}`
        }
    }
    if (lines.length < 3 && line.trim()) lines.push(line.trim())
    if (lines.length === 0) return

    ctx.font = `${Math.round(P * 3)}px ui-monospace, monospace`
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 10
    const height = lines.length * P * 4 + 8
    const bx = r.x * TILE + TILE / 2 - width / 2
    const by = r.y * TILE - height - 6

    ctx.fillStyle = 'rgba(244,244,248,0.96)'
    ctx.fillRect(bx, by, width, height)
    ctx.fillStyle = 'rgba(244,244,248,0.96)'
    ctx.beginPath()
    ctx.moveTo(r.x * TILE + TILE / 2 - 4, by + height)
    ctx.lineTo(r.x * TILE + TILE / 2 + 4, by + height)
    ctx.lineTo(r.x * TILE + TILE / 2, by + height + 6)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = '#18181b'
    ctx.textAlign = 'center'
    lines.forEach((l, i) => {
        ctx.fillText(l, bx + width / 2, by + 10 + i * P * 4)
    })
}

export function WorldCanvas({ floor, agents, selectedId, onSelect, zoom }: Props) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const rendered = useRef<Map<string, Rendered>>(new Map())
    const agentsRef = useRef(agents)
    const floorRef = useRef(floor)

    agentsRef.current = agents
    floorRef.current = floor

    const size = useMemo(
        () => ({ w: floor.width * TILE, h: floor.height * TILE }),
        [floor.width, floor.height]
    )

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        let raf = 0
        const dpr = Math.min(window.devicePixelRatio || 1, 2)

        const render = (t: number) => {
            const currentFloor = floorRef.current
            const w = currentFloor.width * TILE
            const h = currentFloor.height * TILE

            if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
                canvas.width = w * dpr
                canvas.height = h * dpr
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            ctx.imageSmoothingEnabled = false
            ctx.clearRect(0, 0, w, h)

            for (let y = 0; y < currentFloor.height; y++) {
                for (let x = 0; x < currentFloor.width; x++) {
                    drawTile(ctx, tileAt(currentFloor, x, y), x, y, currentFloor.palette, t)
                }
            }

            const live = agentsRef.current
            const ids = new Set(live.map((a) => a.id))
            for (const key of rendered.current.keys()) {
                if (!ids.has(key)) rendered.current.delete(key)
            }

            // Ease each sprite toward its logical tile so a one-tile server step
            // reads as a walk rather than a teleport.
            for (const agent of live) {
                let r = rendered.current.get(agent.id)
                if (!r) {
                    r = { x: agent.position.x, y: agent.position.y, facing: 'down', step: 0 }
                    rendered.current.set(agent.id, r)
                }
                const dx = agent.position.x - r.x
                const dy = agent.position.y - r.y
                if (Math.abs(dx) > 0.02 || Math.abs(dy) > 0.02) {
                    if (Math.abs(dx) > Math.abs(dy)) r.facing = dx > 0 ? 'right' : 'left'
                    else r.facing = dy > 0 ? 'down' : 'up'
                }
                r.x += dx * 0.16
                r.y += dy * 0.16
            }

            const ordered = [...live].sort((a, b) => {
                const ra = rendered.current.get(a.id)!
                const rb = rendered.current.get(b.id)!
                return ra.y - rb.y
            })
            for (const agent of ordered) {
                drawAgent(ctx, agent, rendered.current.get(agent.id)!, agent.id === selectedId, t)
            }
            for (const agent of ordered) {
                drawBubble(ctx, agent, rendered.current.get(agent.id)!)
            }

            raf = requestAnimationFrame(render)
        }

        raf = requestAnimationFrame(render)
        return () => cancelAnimationFrame(raf)
    }, [selectedId])

    const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const scale = rect.width / (floorRef.current.width * TILE)
        const x = (e.clientX - rect.left) / scale / TILE
        const y = (e.clientY - rect.top) / scale / TILE

        let hit: string | null = null
        for (const [agentId, r] of rendered.current) {
            if (Math.abs(r.x + 0.5 - x) < 0.6 && Math.abs(r.y + 0.5 - y) < 0.8) hit = agentId
        }
        onSelect(hit)
    }

    return (
        <canvas
            ref={canvasRef}
            onClick={handleClick}
            className="cursor-pointer"
            style={{
                width: size.w * zoom,
                height: size.h * zoom,
                imageRendering: 'pixelated',
            }}
        />
    )
}
