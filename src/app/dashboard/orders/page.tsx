"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Search,
    MoreHorizontal,
    Printer,
    RotateCcw,
    Truck,
    Store,
    Filter,
    Download
} from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
// Import Context
import { useMockDatabase } from "@/lib/contexts/mock-db-context"

// Types (Imported from context or redefined if needed locally, but better to use context types if exported)
// function to helpers
const getSourceIcon = (source: string) => {
    switch (source) {
        case 'pos': return <Store className="h-4 w-4 mr-1 text-blue-400" />
        case 'uber': return <Truck className="h-4 w-4 mr-1 text-[#06C167]" />
        case 'doordash': return <Truck className="h-4 w-4 mr-1 text-[#FF3008]" />
        case 'kiosk': return <Store className="h-4 w-4 mr-1 text-purple-400" />
        default: return <Store className="h-4 w-4 mr-1" />
    }
}

const getSourceLabel = (source: string) => {
    switch (source) {
        case 'pos': return 'In-Store'
        case 'uber': return 'Uber Eats'
        case 'doordash': return 'DoorDash'
        case 'kiosk': return 'Kiosk'
        default: return source
    }
}

export default function OrderHistoryPage() {
    const { orders, updateOrderStatus } = useMockDatabase()
    const [searchTerm, setSearchTerm] = useState('')

    const filteredOrders = orders.filter(order =>
        order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (order.customer && order.customer.toLowerCase().includes(searchTerm.toLowerCase()))
    )

    const handleRefund = (id: string) => {
        updateOrderStatus(id, 'refunded')
    }

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Order History</h2>
                    <p className="text-muted-foreground">
                        View and manage past orders from all channels.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" className="gap-2 border-white/10 hover:bg-white/5">
                        <Download className="h-4 w-4" />
                        Export CSV
                    </Button>
                    <Button variant="outline" className="gap-2 border-white/10 hover:bg-white/5">
                        <Filter className="h-4 w-4" />
                        Filter
                    </Button>
                </div>
            </div>

            <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle>Recent Orders</CardTitle>
                        <div className="relative w-64">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search order # or customer..."
                                className="pl-8 bg-black/20 border-white/10"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow className="border-white/10 hover:bg-transparent">
                                <TableHead className="text-white">Order ID</TableHead>
                                <TableHead className="text-white">Source</TableHead>
                                <TableHead className="text-white">Items</TableHead>
                                <TableHead className="text-white">Total</TableHead>
                                <TableHead className="text-white">Status</TableHead>
                                <TableHead className="text-white">Time</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredOrders.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center text-muted-foreground h-24">
                                        No recent orders found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredOrders.map((order) => (
                                    <TableRow key={order.id} className="border-white/10 hover:bg-white/5">
                                        <TableCell className="font-mono text-xs font-medium text-white">
                                            {order.id}
                                            {order.customer && <div className="text-muted-foreground text-[10px] mt-0.5">{order.customer}</div>}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center">
                                                {getSourceIcon(order.source)}
                                                <span>{getSourceLabel(order.source)}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                                            {order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                                        </TableCell>
                                        <TableCell className="font-bold text-white">
                                            ${order.total.toFixed(2)}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={cn(
                                                "capitalize border",
                                                order.status === 'completed' || order.status === 'delivered' ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                                                    order.status === 'refunded' || order.status === 'cancelled' ? "bg-red-500/10 text-red-500 border-red-500/20" :
                                                        "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                                            )}>
                                                {order.status.replace('_', ' ')}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </TableCell>
                                        <TableCell>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-white">
                                                        <span className="sr-only">Open menu</span>
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="bg-zinc-950 border-white/10 text-white">
                                                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                    <DropdownMenuItem className="hover:bg-white/10 cursor-pointer gap-2">
                                                        <Printer className="h-3 w-3" /> Print Receipt
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        className="hover:bg-white/10 cursor-pointer gap-2 text-yellow-500 hover:text-yellow-400"
                                                        onClick={() => handleRefund(order.id)}
                                                    >
                                                        <RotateCcw className="h-3 w-3" /> Refund
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
