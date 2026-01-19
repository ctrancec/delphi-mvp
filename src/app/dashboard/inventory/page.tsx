"use client"

import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search, Filter, Plus, Package, AlertCircle, ArrowUpRight, Save, MoreHorizontal } from "lucide-react"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useMockDatabase } from '@/lib/contexts/mock-db-context'

export default function InventoryPage() {
    const { inventory, updateInventory } = useMockDatabase()
    const [searchTerm, setSearchTerm] = useState('')
    const [filterCategory, setFilterCategory] = useState('All')
    const [isReceiveOpen, setIsReceiveOpen] = useState(false)
    const [receiveForm, setReceiveForm] = useState({ name: '', quantity: '', unit: 'pcs', category: 'Raw Material' })
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editValue, setEditValue] = useState<number>(0)

    const handleReceiveStock = () => {
        // In a real app we'd add new items to DB. For now closing dialog.
        setIsReceiveOpen(false)
    }

    const startEditing = (id: string, currentQty: number) => {
        setEditingId(id)
        setEditValue(currentQty)
    }

    const saveEditing = (id: string) => {
        updateInventory(id, editValue)
        setEditingId(null)
    }

    const filteredInventory = inventory.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || item.sku.toLowerCase().includes(searchTerm.toLowerCase())
        const matchesCategory = filterCategory === 'All' || item.category === filterCategory
        return matchesSearch && matchesCategory
    })

    const totalValue = inventory.reduce((acc, item) => acc + (item.quantity * item.cost), 0)
    const lowStockCount = inventory.filter(item => item.quantity <= item.minLevel).length

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Inventory</h2>
                    <p className="text-muted-foreground">
                        Manage stock levels, valuations, and procurement.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" className="border-white/10 hover:bg-white/5">
                        <Filter className="h-4 w-4 mr-2" />
                        Smart Filter
                    </Button>
                    <Dialog open={isReceiveOpen} onOpenChange={setIsReceiveOpen}>
                        <DialogTrigger asChild>
                            <Button className="gap-2 bg-primary hover:bg-primary/90 text-white">
                                <Plus className="h-4 w-4" />
                                Receive Stock
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-zinc-950 border-white/10 text-white">
                            <DialogHeader>
                                <DialogTitle>Receive Inventory</DialogTitle>
                                <DialogDescription className="text-gray-400">Add new stock to the warehouse.</DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <Label>Item Name</Label>
                                <Input className="bg-white/5 border-white/10 text-white" placeholder="Module disabled in demo" disabled />
                            </div>
                            <DialogFooter>
                                <Button onClick={() => setIsReceiveOpen(false)} className="bg-emerald-600">to be implemented</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Valuation</CardTitle>
                        <DollarSign className="h-4 w-4 text-emerald-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <ArrowUpRight className="h-3 w-3 text-emerald-400" />
                            <span className="text-emerald-400">+12%</span> vs last month
                        </p>
                    </CardContent>
                </Card>
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Low Stock Alerts</CardTitle>
                        <AlertCircle className="h-4 w-4 text-yellow-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{lowStockCount} Items</div>
                        <p className="text-xs text-muted-foreground mt-1 text-yellow-500">Action required</p>
                    </CardContent>
                </Card>
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Out of Stock</CardTitle>
                        <Package className="h-4 w-4 text-red-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{inventory.filter(i => i.quantity === 0).length} Items</div>
                        <p className="text-xs text-muted-foreground mt-1">Restock immediately</p>
                    </CardContent>
                </Card>
            </div>

            <div className="flex items-center gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name or SKU..."
                        className="pl-9 bg-black/40 border-white/10 text-white placeholder:text-muted-foreground"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                    <SelectTrigger className="w-[180px] bg-black/40 border-white/10 text-white">
                        <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-950 border-white/10 text-white">
                        <SelectItem value="All">All Categories</SelectItem>
                        <SelectItem value="Raw Material">Raw Material</SelectItem>
                        <SelectItem value="Produce">Produce</SelectItem>
                        <SelectItem value="Dairy">Dairy</SelectItem>
                        <SelectItem value="Bakery">Bakery</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="rounded-md border border-white/10 bg-black/40 overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-white/5 text-muted-foreground font-medium uppercase text-xs">
                        <tr>
                            <th className="px-4 py-3">Item Name</th>
                            <th className="px-4 py-3">Category</th>
                            <th className="px-4 py-3">In Stock</th>
                            <th className="px-4 py-3">Unit</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {filteredInventory.map((item) => {
                            const health = (item.quantity / (item.minLevel * 2)) * 100
                            const statusColor = item.quantity === 0 ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                item.quantity <= item.minLevel ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' :
                                    'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                            const statusText = item.quantity === 0 ? 'Out of Stock' : item.quantity <= item.minLevel ? 'Low Stock' : 'Good'

                            return (
                                <tr key={item.id} className="hover:bg-white/5 transition-colors">
                                    <td className="px-4 py-3 font-medium text-white">
                                        <div>{item.name}</div>
                                        <div className="text-[10px] text-muted-foreground font-mono">{item.sku}</div>
                                    </td>
                                    <td className="px-4 py-3">{item.category}</td>
                                    <td className="px-4 py-3">
                                        {editingId === item.id ? (
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    type="number"
                                                    className="h-8 w-20 bg-black border-white/20"
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(Number(e.target.value))}
                                                />
                                                <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-emerald-400" onClick={() => saveEditing(item.id)}>
                                                    <Save className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ) : (
                                            <span
                                                className="cursor-pointer hover:underline hover:text-primary"
                                                onClick={() => startEditing(item.id, item.quantity)}
                                                title="Click to edit quantity"
                                            >
                                                {item.quantity}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-muted-foreground">{item.unit}</td>
                                    <td className="px-4 py-3">
                                        <Badge variant="outline" className={`text-[10px] ${statusColor}`}>
                                            {statusText}
                                        </Badge>
                                        <div className="w-16 h-1 mt-1 bg-white/10 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full ${item.quantity <= item.minLevel ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                                                style={{ width: `${Math.min(health, 100)}%` }}
                                            />
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                            <span className="sr-only">Open menu</span>
                                            <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

function DollarSign(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <line x1="12" x2="12" y1="2" y2="22" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
    )
}

