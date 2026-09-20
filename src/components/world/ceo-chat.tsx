"use client"

import React, { useEffect, useRef, useState } from 'react'
import { Send, Loader2, Bot, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ChatMessage, WorldState } from '@/lib/world/types'

interface Props {
    state: WorldState
    thinking: boolean
    onSend: (message: string) => void
}

const CEO_CHANNEL = 'ceo'

export function CeoChat({ state, thinking, onSend }: Props) {
    const [draft, setDraft] = useState('')
    const scroller = useRef<HTMLDivElement | null>(null)
    const messages = state.chat.filter((m) => m.channel === CEO_CHANNEL)
    const ceo = state.agents.find((a) => a.role === 'ceo')

    useEffect(() => {
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
    }, [messages.length, thinking])

    const submit = () => {
        const text = draft.trim()
        if (!text || thinking) return
        setDraft('')
        onSend(text)
    }

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <div className="h-2 w-2 rounded-full bg-emerald-400" />
                <div>
                    <p className="text-sm font-medium">{ceo?.name ?? 'CEO'}</p>
                    <p className="text-xs text-muted-foreground">
                        {ceo?.title ?? 'Chief Executive Agent'} · reports to you
                    </p>
                </div>
            </div>

            <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {messages.map((m) => (
                    <Message key={m.id} message={m} ceoName={ceo?.name ?? 'CEO'} />
                ))}
                {thinking && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {ceo?.name ?? 'The CEO'} is working on it…
                    </div>
                )}
            </div>

            <div className="border-t border-border p-3">
                <div className="flex gap-2">
                    <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                submit()
                            }
                        }}
                        placeholder="Tell your CEO what you want built…"
                        className="min-h-[60px] resize-none text-sm"
                    />
                    <Button onClick={submit} disabled={thinking || !draft.trim()} size="icon" className="h-auto">
                        {thinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                    Enter to send · Shift+Enter for a new line
                </p>
            </div>
        </div>
    )
}

function Message({ message, ceoName }: { message: ChatMessage; ceoName: string }) {
    if (message.role === 'system') {
        return (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {message.content}
            </div>
        )
    }

    const isHuman = message.role === 'human'
    return (
        <div className={`flex gap-2 ${isHuman ? 'justify-end' : ''}`}>
            {!isHuman && (
                <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-primary/20">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
            )}
            <div
                className={`max-w-[85%] rounded-md px-3 py-2 text-sm leading-relaxed ${
                    isHuman ? 'bg-primary text-primary-foreground' : 'bg-secondary'
                }`}
            >
                {!isHuman && (
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {ceoName}
                    </p>
                )}
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.toolCalls && message.toolCalls.length > 0 && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                        used: {Array.from(new Set(message.toolCalls)).join(', ')}
                    </p>
                )}
            </div>
            {isHuman && (
                <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-secondary">
                    <User className="h-3.5 w-3.5" />
                </div>
            )}
        </div>
    )
}
