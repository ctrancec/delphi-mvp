'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { CheckCircle2, Clock, AlertCircle, CheckSquare, Square, Truck } from 'lucide-react'
import { cn } from '@/lib/utils'

// Types
type TicketItem = {
    name: string
    qty: number
    notes?: string
    completed: boolean
}

type Ticket = {
    id: string
    type: 'dine-in' | 'delivery'
    source: 'server' | 'uber' | 'doordash'
    table?: number // Only for dine-in
    server?: string // Only for dine-in
    startTime: number // Timestamp
    status: 'New' | 'Cooking' | 'Ready'
    items: TicketItem[]
}

// Mock Data
const INITIAL_TICKETS: Ticket[] = [
    {
        id: "TICK-104",
        type: 'dine-in',
        source: 'server',
        table: 4,
        server: "Alice",
        startTime: Date.now() - 1000 * 60 * 12, // 12 mins ago
        status: "Cooking",
        items: [
            { name: "Avocado Toast", qty: 2, notes: "No onions", completed: false },
            { name: "Cappuccino", qty: 2, notes: "Oat milk", completed: true }
        ]
    },
    {
        id: "UE-8892",
        type: 'delivery',
        source: 'uber',
        startTime: Date.now() - 1000 * 60 * 5, // 5 mins ago
        status: "New",
        items: [
            { name: "Spicy Tuna Roll", qty: 2, completed: false },
            { name: "Miso Soup", qty: 2, completed: false }
        ]
    },
    {
        id: "DD-121",
        type: 'delivery',
        source: 'doordash',
        startTime: Date.now() - 1000 * 60 * 2, // 2 mins ago
        status: "New",
        items: [
            { name: "Cheeseburger", qty: 1, notes: "No pickle", completed: false },
            { name: "Fries", qty: 1, completed: false }
        ]
    }
]

export default function KitchenPage() {
    const [tickets, setTickets] = useState<Ticket[]>(INITIAL_TICKETS)
    const [now, setNow] = useState(() => Date.now())

    // Update timers every minute
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000 * 60)
        return () => clearInterval(interval)
    }, [])

    const toggleItem = (ticketId: string, itemIndex: number) => {
        setTickets(prev => prev.map(t => {
            if (t.id === ticketId) {
                const newItems = [...t.items]
                newItems[itemIndex].completed = !newItems[itemIndex].completed

                // Auto-check if all items are done? Optional.
                const allDone = newItems.every(i => i.completed)

                return { ...t, items: newItems }
            }
            return t
        }))
    }

    const startTicket = (id: string) => {
        setTickets(prev => prev.map(t =>
            t.id === id ? { ...t, status: 'Cooking' } : t
        ))
    }

    const completeTicket = (id: string) => {
        setTickets(prev => prev.filter(t => t.id !== id))
    }

    const getElapsed = (startTime: number) => {
        return Math.floor((now - startTime) / 60000)
    }

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Kitchen Display</h2>
                    <p className="text-muted-foreground">
                        Live ticket management with item-level tracking.
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">
                            Avg Ticket: 14m
                        </Badge>
                        <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                            Backlog: {tickets.length}
                        </Badge>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {tickets.map(ticket => {
                    const elapsed = getElapsed(ticket.startTime)
                    return (
                        <Card key={ticket.id} className={cn(
                            "flex flex-col border-2 transition-all",
                            ticket.status === 'Cooking' ? "border-yellow-500/50 bg-yellow-500/5" : "border-white/10 bg-white/5"
                        )}>
                            <CardHeader className="pb-3 border-b border-white/5 bg-white/5">
                                <div className="flex justify-between items-start">
                                    <div>
                                        {ticket.type === 'dine-in' ? (
                                            <>
                                                <CardTitle className="text-lg">Table {ticket.table}</CardTitle>
                                                <p className="text-xs text-muted-foreground mt-1">Server: {ticket.server}</p>
                                            </>
                                        ) : (
                                            <>
                                                <CardTitle className={cn(
                                                    "text-lg flex items-center gap-2",
                                                    ticket.source === 'uber' ? "text-[#06C167]" : "text-[#FF3008]"
                                                )}>
                                                    <Truck className="h-5 w-5" />
                                                    {ticket.source === 'uber' ? 'Uber Eats' : 'DoorDash'}
                                                </CardTitle>
                                                <p className="text-xs text-muted-foreground mt-1">Delivery</p>
                                            </>
                                        )}
                                    </div>
                                    <div className="text-right">
                                        <span className="font-mono text-lg font-bold">#{ticket.id}</span>
                                        <div className={cn(
                                            "flex items-center gap-1 text-xs font-bold mt-1",
                                            elapsed > 10 ? "text-red-500" : "text-emerald-500"
                                        )}>
                                            <Clock className="h-3 w-3" />
                                            {elapsed}m
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="flex-1 p-4 space-y-4">
                                <div className="space-y-3">
                                    {ticket.items.map((item, i) => (
                                        <div
                                            key={i}
                                            className={cn(
                                                "flex justify-between items-start text-sm p-2 rounded cursor-pointer transition-colors select-none",
                                                item.completed ? "bg-emerald-500/10 opacity-50" : "hover:bg-white/5"
                                            )}
                                            onClick={() => toggleItem(ticket.id, i)}
                                        >
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    {item.completed ?
                                                        <CheckSquare className="h-4 w-4 text-emerald-500" /> :
                                                        <Square className="h-4 w-4 text-muted-foreground" />
                                                    }
                                                    <span className={cn("font-bold mr-2", item.completed ? "text-emerald-500" : "text-white")}>{item.qty}</span>
                                                    <span className={cn("text-gray-300", item.completed && "line-through")}>{item.name}</span>
                                                </div>
                                                {item.notes && (
                                                    <p className="text-xs text-yellow-500/80 italic mt-0.5 ml-8">
                                                        Note: {item.notes}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                            <div className="p-4 pt-0 mt-auto">
                                {ticket.status === 'New' ? (
                                    <Button
                                        className="w-full bg-yellow-600 hover:bg-yellow-700 text-white"
                                        onClick={() => startTicket(ticket.id)}
                                    >
                                        Start Cooking
                                    </Button>
                                ) : (
                                    <Button
                                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                                        onClick={() => completeTicket(ticket.id)}
                                        disabled={!ticket.items.every(i => i.completed)}
                                    >
                                        <CheckCircle2 className="h-4 w-4 mr-2" />
                                        {ticket.items.every(i => i.completed) ? "Complete Order" : "Mark Items Done"}
                                    </Button>
                                )}
                            </div>
                        </Card>
                    )
                })}
            </div>
        </div>
    )
}
