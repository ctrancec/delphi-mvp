'use client'

import React, { useState } from 'react'
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
    Search,
    ShoppingCart,
    Trash2,
    CreditCard,
    Plus,
    Minus,
    Printer
} from 'lucide-react'
import { cn } from "@/lib/utils"
// import { usePrinter } from '@/lib/printing/printer-context'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

import { UnifiedMenuItem } from "@/lib/types/menu"
import { INITIAL_MENU_DATA, MENU_CATEGORIES } from "@/lib/data/menu-data"
import { useMockDatabase } from '@/lib/contexts/mock-db-context'

import { PaymentModal } from '@/components/features/pos/payment-modal'

export default function POSPage() {
    const { createOrder } = useMockDatabase()
    const [cart, setCart] = useState<{ product: UnifiedMenuItem, qty: number }[]>([])
    const [search, setSearch] = useState('')
    const [category, setCategory] = useState("All")
    const [table, setTable] = useState<string>("4")
    const [taxRate, setTaxRate] = useState<number>(0.08)

    // Payment Modal State
    const [showPayment, setShowPayment] = useState(false)

    const addToCart = (product: UnifiedMenuItem) => {
        setCart(prev => {
            const existing = prev.find(item => item.product.id === product.id)
            if (existing) {
                return prev.map(item =>
                    item.product.id === product.id ? { ...item, qty: item.qty + 1 } : item
                )
            }
            return [...prev, { product, qty: 1 }]
        })
    }

    const removeFromCart = (productId: string) => {
        setCart(prev => prev.filter(item => item.product.id !== productId))
    }

    const updateQty = (productId: string, delta: number) => {
        setCart(prev => prev.map(item => {
            if (item.product.id === productId) {
                const newQty = Math.max(1, item.qty + delta)
                return { ...item, qty: newQty }
            }
            return item
        }))
    }

    const total = cart.reduce((acc, item) => acc + (item.product.price * item.qty), 0)
    const tax = total * taxRate
    const finalTotal = total + tax

    const filteredProducts = INITIAL_MENU_DATA.filter(p =>
        (category === "All" || p.category === category) &&
        p.name.toLowerCase().includes(search.toLowerCase())
    )

    // Triggered AFTER successful Stripe Payment
    const handlePaymentSuccess = async () => {
        setShowPayment(false)

        // Create Global Order (Record Success)
        createOrder({
            tableId: table,
            items: cart.map(i => ({ name: i.product.name, quantity: i.qty, price: i.product.price })),
            status: 'preparing',
            total: finalTotal,

            type: 'dine-in',
            source: 'pos',
            customer: 'Guest',
            externalId: undefined
        })

        setCart([])
    }

    return (
        <div className="flex h-full gap-6">
            <PaymentModal
                open={showPayment}
                onOpenChange={setShowPayment}
                amount={finalTotal}
                onSuccess={handlePaymentSuccess}
            />

            {/* Left Side: Product Grid */}
            <div className="flex-1 flex flex-col gap-6 h-full overflow-hidden">
                {/* Search & Filter Bar */}
                <div className="flex items-center justify-between gap-4 shrink-0">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search products..."
                            className="pl-9 h-10 bg-white/5 border-white/10"
                        />
                    </div>
                    <div className="flex gap-2">
                        {["All", ...MENU_CATEGORIES].map(cat => (
                            <Button
                                key={cat}
                                variant={category === cat ? "default" : "outline"}
                                onClick={() => setCategory(cat)}
                                className={cn(
                                    "border-white/10",
                                    category !== cat && "hover:bg-white/5 hover:text-white"
                                )}
                            >
                                {cat}
                            </Button>
                        ))}
                    </div>
                </div>

                {/* Grid */}
                <div className="flex-1 overflow-y-auto pr-2 rounded-lg scrollbar-thin scrollbar-thumb-white/10">
                    <div className="grid grid-cols-3 xl:grid-cols-4 gap-4 pb-20">
                        {filteredProducts.map(product => (
                            <Card
                                key={product.id}
                                className="cursor-pointer bg-white/5 border-white/10 hover:bg-white/10 transition-colors active:scale-95"
                                onClick={() => addToCart(product)}
                            >
                                <CardContent className="p-4 flex flex-col items-center text-center gap-3">
                                    <div className="text-4xl">{product.image}</div>
                                    <div>
                                        <div className="font-medium text-white truncate w-full">{product.name}</div>
                                        <div className="text-sm text-muted-foreground">${product.price.toFixed(2)}</div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right Side: Cart */}
            <Card className="w-[400px] flex flex-col bg-black/40 border-white/10 backdrop-blur-xl h-full shrink-0">
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                    <div className="font-bold text-lg flex items-center gap-2">
                        <ShoppingCart className="h-5 w-5" />
                        Current Order
                    </div>
                    <Dialog>
                        <DialogTrigger asChild>
                            <Badge variant="secondary" className="bg-primary/20 text-primary cursor-pointer hover:bg-primary/30">
                                Table {table}
                            </Badge>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px] bg-black border-white/10 text-white">
                            <DialogHeader>
                                <DialogTitle>Order Settings</DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="table" className="text-right">Table #</Label>
                                    <Input
                                        id="table"
                                        className="col-span-3 bg-white/5 border-white/10 text-white"
                                        value={table}
                                        onChange={(e) => setTable(e.target.value)}
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="tax" className="text-right">Tax Rate</Label>
                                    <div className="col-span-3">
                                        <select
                                            className="w-full h-10 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                            value={taxRate}
                                            onChange={(e) => setTaxRate(parseFloat(e.target.value))}
                                        >
                                            <option value={0.05}>5% (GST)</option>
                                            <option value={0.08}>8% (Standard)</option>
                                            <option value={0.13}>13% (HST)</option>
                                            <option value={0.15}>15% (HST)</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {cart.length === 0 ? (
                        <div className="text-center text-muted-foreground py-10 opacity-50">
                            Cart is empty.
                        </div>
                    ) : (
                        cart.map(({ product, qty }) => (
                            <div key={product.id} className="flex items-center justify-between group">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 bg-white/5 rounded-md flex items-center justify-center text-xl">
                                        {product.image}
                                    </div>
                                    <div>
                                        <div className="font-medium text-sm text-white">{product.name}</div>
                                        <div className="text-xs text-muted-foreground">${product.price.toFixed(2)}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1 bg-white/5 rounded-md">
                                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateQty(product.id, -1)}>
                                            <Minus className="h-3 w-3" />
                                        </Button>
                                        <span className="text-sm w-4 text-center">{qty}</span>
                                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateQty(product.id, 1)}>
                                            <Plus className="h-3 w-3" />
                                        </Button>
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-400" onClick={() => removeFromCart(product.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-4 border-t border-white/10 space-y-4 bg-white/5">
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between text-muted-foreground">
                            <span>Subtotal</span>
                            <span>${total.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                            <span>Tax ({(taxRate * 100).toFixed(0)}%)</span>
                            <span>${tax.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-white font-bold text-lg pt-2 border-t border-white/10">
                            <span>Total</span>
                            <span>${finalTotal.toFixed(2)}</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        {/* <Button variant="outline" className="border-white/10 hover:bg-white/5" disabled>
                            <Printer className="h-5 w-5 mr-2" />
                            Print Receipt
                        </Button> */}
                        <Button
                            className="bg-emerald-500 hover:bg-emerald-600 text-white h-12 text-lg"
                            onClick={() => setShowPayment(true)}
                            disabled={cart.length === 0}
                        >
                            <CreditCard className="h-5 w-5 mr-2" />
                            {`Charge $${finalTotal.toFixed(2)}`}
                        </Button>
                    </div>
                </div>
            </Card>
        </div>
    )
}
