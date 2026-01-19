"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Plus,
    Trash2,
    Save,
    Send,
    ArrowLeft,
    Calendar as CalendarIcon
} from "lucide-react"
import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

interface LineItem {
    id: string
    description: string
    quantity: number
    price: number
}

export default function CreateInvoicePage() {
    const router = useRouter()
    const [items, setItems] = useState<LineItem[]>([
        { id: '1', description: 'Consulting Services', quantity: 1, price: 150.00 }
    ])

    const addItem = () => {
        setItems([...items, { id: crypto.randomUUID(), description: '', quantity: 1, price: 0 }])
    }

    const removeItem = (id: string) => {
        setItems(items.filter(item => item.id !== id))
    }

    const updateItem = (id: string, field: keyof LineItem, value: string | number) => {
        setItems(items.map(item =>
            item.id === id ? { ...item, [field]: value } : item
        ))
    }

    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.price), 0)
    const taxRate = 0.05 // 5% mock tax
    const tax = subtotal * taxRate
    const total = subtotal + tax

    return (
        <div className="space-y-8 max-w-5xl mx-auto">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => router.back()}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight">New Invoice</h2>
                        <p className="text-muted-foreground">
                            Draft a new invoice for your client.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" className="gap-2">
                        <Save className="h-4 w-4" />
                        Save Draft
                    </Button>
                    <Button className="gap-2 bg-primary hover:bg-primary/90 text-white">
                        <Send className="h-4 w-4" />
                        Send Invoice
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Main Form */}
                <div className="lg:col-span-2 space-y-6">
                    <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                        <CardHeader>
                            <CardTitle>Invoice Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Client</Label>
                                    <select className="w-full h-10 px-3 rounded-md border border-white/10 bg-black/20 text-sm">
                                        <option>Select Client...</option>
                                        <option>Acme Corp</option>
                                        <option>Globex Inc</option>
                                        <option>Initech</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Invoice Number</Label>
                                    <Input defaultValue="INV-2024-006" className="bg-black/20 border-white/10" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Issue Date</Label>
                                    <div className="relative">
                                        <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input type="date" className="pl-9 bg-black/20 border-white/10" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Due Date</Label>
                                    <div className="relative">
                                        <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input type="date" className="pl-9 bg-black/20 border-white/10" />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>Line Items</CardTitle>
                            <Button variant="outline" size="sm" onClick={addItem} className="gap-2">
                                <Plus className="h-3 w-3" /> Add Item
                            </Button>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-white/10 hover:bg-transparent">
                                        <TableHead className="w-[40%] text-white">Description</TableHead>
                                        <TableHead className="text-white">Qty</TableHead>
                                        <TableHead className="text-white">Price</TableHead>
                                        <TableHead className="text-right text-white">Total</TableHead>
                                        <TableHead className="w-[50px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {items.map((item) => (
                                        <TableRow key={item.id} className="border-white/10 hover:bg-white/5">
                                            <TableCell>
                                                <Input
                                                    value={item.description}
                                                    onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                                                    placeholder="Item name..."
                                                    className="bg-transparent border-none p-0 h-auto focus-visible:ring-0 placeholder:text-muted-foreground/50"
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Input
                                                    type="number"
                                                    value={item.quantity}
                                                    onChange={(e) => updateItem(item.id, 'quantity', parseInt(e.target.value) || 0)}
                                                    className="w-20 bg-black/20 border-white/10 h-8"
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <div className="relative">
                                                    <span className="absolute left-2 top-1.5 text-xs text-muted-foreground">$</span>
                                                    <Input
                                                        type="number"
                                                        value={item.price}
                                                        onChange={(e) => updateItem(item.id, 'price', parseFloat(e.target.value) || 0)}
                                                        className="w-24 pl-5 bg-black/20 border-white/10 h-8"
                                                    />
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right font-medium text-white">
                                                ${(item.quantity * item.price).toFixed(2)}
                                            </TableCell>
                                            <TableCell>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-muted-foreground hover:text-red-400"
                                                    onClick={() => removeItem(item.id)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>

                    <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                        <CardHeader>
                            <CardTitle>Notes & Terms</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Notes</Label>
                                <Textarea placeholder="Thank you for your business..." className="bg-black/20 border-white/10 min-h-[100px]" />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Sidebar / Summary */}
                <div className="space-y-6">
                    <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                        <CardHeader>
                            <CardTitle>Summary</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Subtotal</span>
                                <span className="text-white">${subtotal.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Tax (5%)</span>
                                <span className="text-white">${tax.toFixed(2)}</span>
                            </div>
                            <div className="border-t border-white/10 pt-4 flex justify-between items-center">
                                <span className="font-bold text-white">Total</span>
                                <span className="font-bold text-xl text-primary">${total.toFixed(2)}</span>
                            </div>
                        </CardContent>
                        <CardFooter>
                            <Button className="w-full bg-emerald-500 hover:bg-emerald-600 text-white">
                                <Send className="h-4 w-4 mr-2" /> Send Invoice
                            </Button>
                        </CardFooter>
                    </Card>
                </div>
            </div>
        </div>
    )
}
