"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Calendar, Trash2 } from "lucide-react"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { useMockDatabase } from '@/lib/contexts/mock-db-context'
import { useWorkspace } from '@/lib/contexts/workspace-context'
import { TaxCode } from '@/lib/types/finance'
import { calculateTax, PROVINCIAL_RATES } from '@/lib/utils/tax-exports'

export default function NewInvoicePage() {
    const router = useRouter()
    const { activeWorkspace } = useWorkspace()
    const { clients, createInvoice } = useMockDatabase()

    // Form State
    const [clientId, setClientId] = useState<string>('')
    const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0])
    const [dueDate, setDueDate] = useState(new Date(Date.now() + 12096e5).toISOString().split('T')[0]) // +14 days
    const [notes, setNotes] = useState('')
    const [province, setProvince] = useState('ON')

    const [items, setItems] = useState<{ id: string, description: string, quantity: number, price: number, taxCode: TaxCode }[]>([
        { id: '1', description: '', quantity: 1, price: 0, taxCode: 'standard' }
    ])

    const addItem = () => {
        setItems([...items, { id: Math.random().toString(), description: '', quantity: 1, price: 0, taxCode: 'standard' }])
    }

    const removeItem = (id: string) => {
        if (items.length === 1) return
        setItems(items.filter(i => i.id !== id))
    }

    const updateItem = (id: string, field: string, value: any) => {
        setItems(items.map(item =>
            item.id === id ? { ...item, [field]: value } : item
        ))
    }

    const calculateTotals = () => {
        let subtotal = 0
        let totalTax = 0

        items.forEach(item => {
            const lineTotal = item.quantity * item.price
            subtotal += lineTotal
            const { total } = calculateTax(lineTotal, item.taxCode, province)
            totalTax += total
        })

        return { subtotal, tax: totalTax, total: subtotal + totalTax }
    }

    const { subtotal, tax, total } = calculateTotals()

    const handleSave = () => {
        if (!clientId) return

        createInvoice({
            workspaceId: activeWorkspace.id,
            clientId,
            status: 'Pending',
            issueDate,
            dueDate,
            notes,
            items,
            subtotal,
            tax,
            total
        })

        router.push('/dashboard/invoices')
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Create Invoice</h2>
                <p className="text-muted-foreground">
                    Draft a new invoice for a client.
                </p>
            </div>

            <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                <CardHeader>
                    <CardTitle>Invoice Details</CardTitle>
                    <CardDescription>Enter the primary details for this invoice.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-1 space-y-2">
                            <Label htmlFor="client">Client</Label>
                            <Select value={clientId} onValueChange={setClientId}>
                                <SelectTrigger className="bg-black/20 border-white/10">
                                    <SelectValue placeholder="Select a client" />
                                </SelectTrigger>
                                <SelectContent className="bg-black/90 border-white/10 text-white">
                                    {clients.map(client => (
                                        <SelectItem key={client.id} value={client.id}>
                                            {client.company || client.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Place of Supply (Province)</Label>
                            <Select value={province} onValueChange={setProvince}>
                                <SelectTrigger className="bg-black/20 border-white/10">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-black/90 border-white/10 text-white h-[200px]">
                                    {Object.entries(PROVINCIAL_RATES).map(([code, rate]) => (
                                        <SelectItem key={code} value={code}>{code} - {rate.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="date">Due Date</Label>
                            <div className="relative">
                                <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="date"
                                    type="date"
                                    value={dueDate}
                                    onChange={(e) => setDueDate(e.target.value)}
                                    className="pl-9 bg-black/20 border-white/10"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Line Items</Label>
                        <div className="border border-white/10 rounded-lg p-4 space-y-4">
                            <div className="grid grid-cols-12 gap-2 text-sm text-muted-foreground mb-2">
                                <div className="col-span-4">Description</div>
                                <div className="col-span-2">Tax Rule</div>
                                <div className="col-span-1 text-right">Qty</div>
                                <div className="col-span-2 text-right">Price</div>
                                <div className="col-span-2 text-right">Total</div>
                                <div className="col-span-1"></div>
                            </div>

                            {items.map((item) => (
                                <div key={item.id} className="grid grid-cols-12 gap-2 items-center">
                                    <div className="col-span-4">
                                        <Input
                                            placeholder="Item description"
                                            className="bg-black/20 border-white/10"
                                            value={item.description}
                                            onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <Select value={item.taxCode || 'standard'} onValueChange={(val) => updateItem(item.id, 'taxCode', val)}>
                                            <SelectTrigger className="h-9 bg-black/20 border-white/10 text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-zinc-900 border-white/10 text-white">
                                                <SelectItem value="standard">Standard</SelectItem>
                                                <SelectItem value="gst_only">GST Only (5%)</SelectItem>
                                                <SelectItem value="exempt">Exempt (0%)</SelectItem>
                                                <SelectItem value="zero_rated">Zero-Rated (0%)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="col-span-1">
                                        <Input
                                            type="number"
                                            className="text-right bg-black/20 border-white/10"
                                            value={item.quantity}
                                            onChange={(e) => updateItem(item.id, 'quantity', Number(e.target.value))}
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <Input
                                            type="number"
                                            className="text-right bg-black/20 border-white/10"
                                            value={item.price}
                                            onChange={(e) => updateItem(item.id, 'price', Number(e.target.value))}
                                        />
                                    </div>
                                    <div className="col-span-2 text-right font-medium text-white">
                                        ${(item.quantity * item.price).toFixed(2)}
                                    </div>
                                    <div className="col-span-1 text-center">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => removeItem(item.id)}
                                            className="h-8 w-8 text-muted-foreground hover:text-red-400"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}

                            <Button
                                variant="outline"
                                size="sm"
                                onClick={addItem}
                                className="w-full border-dashed border-white/20 text-muted-foreground hover:text-white"
                            >
                                + Add Line Item
                            </Button>
                        </div>
                    </div>

                    {/* Totals Section */}
                    <div className="flex justify-end">
                        <div className="w-1/2 space-y-2 p-4 bg-white/5 rounded-lg border border-white/5">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Subtotal</span>
                                <span className="text-white">${subtotal.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Tax ({province})</span>
                                <span className="text-emerald-400 font-medium">+${tax.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-lg font-bold border-t border-white/10 pt-2 mt-2">
                                <span>Total</span>
                                <span className="text-primary">${total.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="notes">Notes</Label>
                        <Textarea
                            id="notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Payment terms, bank details, or thank you note..."
                            className="bg-black/20 border-white/10 min-h-[100px]"
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                        <Button variant="outline" onClick={() => router.back()} className="border-white/10">Cancel</Button>
                        <Button onClick={handleSave} disabled={!clientId} className="bg-primary hover:bg-primary/90 text-white">Create Invoice</Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
