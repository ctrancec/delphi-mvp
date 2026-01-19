"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Truck,
    RefreshCw,
    CheckCircle2,
    XCircle,
    ExternalLink,
    Settings,
    AlertTriangle
} from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

import { useMockDatabase } from "@/lib/contexts/mock-db-context"

export default function DeliveryHubPage() {
    const { createOrder } = useMockDatabase()
    const [integrations, setIntegrations] = useState([
        { id: 'uber', name: 'Uber Eats', status: 'connected', ordersToday: 12, revenue: '$450.00' },
        { id: 'doordash', name: 'DoorDash', status: 'connected', ordersToday: 8, revenue: '$320.50' },
        { id: 'grubhub', name: 'GrubHub', status: 'disconnected', ordersToday: 0, revenue: '$0.00' },
    ])

    const toggleStatus = (id: string) => {
        setIntegrations(prev => prev.map(int =>
            int.id === id ? { ...int, status: int.status === 'connected' ? 'disconnected' : 'connected' } : int
        ))
    }

    const simulateIncomingOrder = () => {
        const platforms = ['uber', 'doordash']
        const randomPlatform = platforms[Math.floor(Math.random() * platforms.length)]
        const randomItems = [
            { name: 'Spicy Tuna Roll', price: 12.00, quantity: 2 },
            { name: 'Miso Soup', price: 4.00, quantity: 1 },
            { name: 'Family Combo', price: 45.00, quantity: 1 }
        ]
        const item = randomItems[Math.floor(Math.random() * randomItems.length)]

        createOrder({
            items: [item],
            type: 'delivery',
            status: 'pending',
            total: item.price * item.quantity,
            tableId: '0',
            source: randomPlatform as 'uber' | 'doordash',
            customer: `Guest #${Math.floor(Math.random() * 9000) + 1000}`
        })

        // Visual feedback
        setIntegrations(prev => prev.map(int =>
            int.id === randomPlatform ? { ...int, ordersToday: int.ordersToday + 1, revenue: `$${(parseFloat(int.revenue.replace('$', '')) + (item.price * item.quantity)).toFixed(2)}` } : int
        ))

        // Optional: Show toast or alert in real app
        // toast.success(`New order from ${randomPlatform}`)
    }

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Delivery Hub</h2>
                    <p className="text-muted-foreground">
                        Manage all your third-party delivery platforms in one place.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" className="gap-2" onClick={simulateIncomingOrder}>
                        <Truck className="h-4 w-4" />
                        Simulate Order
                    </Button>
                    <Button variant="outline" className="gap-2">
                        <Settings className="h-4 w-4" />
                        Settings
                    </Button>
                    <Button className="gap-2 bg-primary hover:bg-primary/90 text-white" onClick={() => alert("Menus synced across all platforms!")}>
                        <RefreshCw className="h-4 w-4" />
                        Sync Menus
                    </Button>
                </div>
            </div>

            {/* Integrations Grid */}
            <div className="grid gap-6 md:grid-cols-3">
                {integrations.map(int => (
                    <Card key={int.id} className="bg-white/5 border-white/10 backdrop-blur-md overflow-hidden">
                        <div className={cn(
                            "h-2 w-full",
                            int.id === 'uber' ? 'bg-[#06C167]' : int.id === 'doordash' ? 'bg-[#FF3008]' : 'bg-[#FC4F09]'
                        )} />
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-lg font-bold">{int.name}</CardTitle>
                            <Badge variant="outline" className={cn(
                                "capitalize border",
                                int.status === 'connected'
                                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                    : "bg-red-500/10 text-red-500 border-red-500/20"
                            )}>
                                {int.status}
                            </Badge>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 gap-4 mb-6">
                                <div>
                                    <p className="text-xs text-muted-foreground">Orders Today</p>
                                    <p className="text-2xl font-bold text-white">{int.ordersToday}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">Revenue</p>
                                    <p className="text-2xl font-bold text-white">{int.revenue}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button
                                    variant={int.status === 'connected' ? "destructive" : "secondary"}
                                    size="sm"
                                    className="w-full"
                                    onClick={() => toggleStatus(int.id)}
                                >
                                    {int.status === 'connected' ? 'Disconnect' : 'Connect Account'}
                                </Button>
                                {int.status === 'connected' && (
                                    <Button variant="outline" size="icon" className="shrink-0 border-white/10">
                                        <ExternalLink className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Live Issues / Alerts */}
            <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-yellow-500" />
                        <CardTitle>Sync Health</CardTitle>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        <div className="flex items-start gap-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                            <RefreshCw className="h-5 w-5 text-yellow-500 mt-0.5" />
                            <div>
                                <h4 className="text-sm font-semibold text-white">Menu Item Mismatch</h4>
                                <p className="text-xs text-muted-foreground mt-1">
                                    "Avocado Toast" price varies between UberEats ($14.00) and POS ($12.00).
                                </p>
                                <Button variant="link" className="h-auto p-0 text-yellow-500 text-xs mt-2">
                                    Fix Automatically
                                </Button>
                            </div>
                        </div>
                        <div className="flex items-start gap-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                            <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5" />
                            <div>
                                <h4 className="text-sm font-semibold text-white">All Systems Operational</h4>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Last sync 2 minutes ago. 99.9% uptime.
                                </p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
