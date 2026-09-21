'use client'

import { ExternalLink, Film, FileText, LineChart } from 'lucide-react'

/**
 * One line of the activity log, rendered as a quest-log entry:
 *
 *   Kit Alvarez   found an important scene   clip_03.mp4 @ 00:04:12 · 38s
 *
 * The third column is a typed source locator, not prose — which is what makes
 * it clickable, and what makes every claim in a finished report traceable back
 * to the exact frame, paragraph or observation it came from.
 */

export type SourceLocator =
    | { kind: 'video'; path: string; tMs: number }
    | { kind: 'url'; url: string; quote?: string }
    | { kind: 'series'; seriesId: string; date: string }
    | { kind: 'doc'; artifactId: string; section?: string }

export interface ActivityEvent {
    id: number
    type: string
    created_at: string
    payload: {
        actor?: string
        verb?: string
        object?: string
        locator?: SourceLocator
        durationMs?: number
        [k: string]: unknown
    } | null
}

/** mm:ss, or h:mm:ss past an hour. */
function timecode(ms: number): string {
    const total = Math.floor(ms / 1000)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const pad = (n: number) => String(n).padStart(2, '0')
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function duration(ms?: number): string | null {
    if (ms === undefined || ms <= 0) return null
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

function Locator({ locator }: { locator: SourceLocator }) {
    const base =
        'inline-flex items-center gap-1 text-muted-foreground hover:text-white transition-colors'

    switch (locator.kind) {
        case 'video':
            return (
                <span className={base} title={`${locator.path} at ${timecode(locator.tMs)}`}>
                    <Film className="h-3 w-3 shrink-0" />
                    {locator.path.split('/').pop()} @ {timecode(locator.tMs)}
                </span>
            )
        case 'url':
            return (
                <a
                    href={locator.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={base}
                    title={locator.quote ?? locator.url}
                >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    {(() => {
                        try {
                            return new URL(locator.url).hostname.replace(/^www\./, '')
                        } catch {
                            // A malformed URL is still worth showing rather than dropping.
                            return locator.url.slice(0, 40)
                        }
                    })()}
                </a>
            )
        case 'series':
            return (
                <span className={base} title={`${locator.seriesId} on ${locator.date}`}>
                    <LineChart className="h-3 w-3 shrink-0" />
                    {locator.seriesId} · {locator.date}
                </span>
            )
        case 'doc':
            return (
                <span className={base} title={locator.section ?? locator.artifactId}>
                    <FileText className="h-3 w-3 shrink-0" />
                    {locator.section ?? 'artifact'}
                </span>
            )
    }
}

/** Fallback wording when an event carried no explicit verb. */
const VERB_FALLBACK: Record<string, string> = {
    department_created: 'created a department',
    hiring_started: 'started staffing',
    agent_hired: 'was hired',
    agent_invented: 'drafted a new agent',
    plan_proposed: 'proposed a team',
    plan_approved: 'approved the team',
    project_started: 'started work',
    task_started: 'started a task',
    task_done: 'finished a task',
    task_failed: 'failed a task',
    task_blocked: 'is blocked',
    handoff: 'handed off',
    artifact_created: 'produced an artifact',
    approval_requested: 'requested approval',
    approval_decided: 'decided an approval',
    budget_halted: 'halted on budget',
    agent_rehired: 'was replaced',
    memory_written: 'recorded a lesson',
}

const TONE: Record<string, string> = {
    task_failed: 'text-red-400',
    // Amber, not red: blocked means waiting on something, not broken.
    task_blocked: 'text-amber-400',
    project_failed: 'text-red-400',
    budget_halted: 'text-amber-400',
    approval_requested: 'text-amber-400',
    agent_rehired: 'text-amber-400',
    plan_approved: 'text-emerald-400',
    task_done: 'text-emerald-400',
}

export function ActivityLine({ event }: { event: ActivityEvent }) {
    const p = event.payload ?? {}
    const actor = p.actor ?? 'System'
    const verb = p.verb ?? VERB_FALLBACK[event.type] ?? event.type.replace(/_/g, ' ')
    const dur = duration(p.durationMs)

    return (
        <div className="flex items-baseline gap-3 py-1 border-b border-white/5 last:border-0">
            <span className={`w-36 shrink-0 truncate ${TONE[event.type] ?? 'text-white'}`}>{actor}</span>
            <span className="flex-1 text-muted-foreground truncate">
                {verb}
                {p.object ? <span className="text-white/80"> {p.object}</span> : null}
            </span>
            <span className="shrink-0 flex items-center gap-2 text-[11px]">
                {p.locator ? <Locator locator={p.locator} /> : null}
                {dur ? <span className="text-muted-foreground/60 tabular-nums">{dur}</span> : null}
            </span>
        </div>
    )
}
