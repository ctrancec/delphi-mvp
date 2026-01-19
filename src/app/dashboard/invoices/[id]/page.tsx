"use client"

import { useMockDatabase } from '@/lib/contexts/mock-db-context'
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Printer, Mail, ArrowLeft, Download } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useWorkspace } from '@/lib/contexts/workspace-context'

export default function InvoiceViewPage() {
    const { id } = useParams()
    const { invoices, clients } = useMockDatabase()
    const { activeWorkspace } = useWorkspace()

    const invoice = invoices.find(inv => inv.id === id)
    const client = invoice ? clients.find(c => c.id === invoice.clientId) : null

    if (!invoice || !client) {
        return (
            <div className="flex items-center justify-center h-[50vh] text-muted-foreground">
                Invoice not found.
            </div>
        )
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div className="flex items-center justify-between no-print">
                <div className="flex items-center gap-4">
                    <Link href="/dashboard/invoices">
                        <Button variant="outline" size="icon" className="h-8 w-8 border-white/10">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">Invoice {id}</h2>
                        <Badge variant="outline" className="mt-1 border-white/20 text-muted-foreground">{invoice.status}</Badge>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" className="gap-2 border-white/10 hover:bg-white/5">
                        <Printer className="h-4 w-4" />
                        Print / PDF
                    </Button>
                    <Button className="gap-2 bg-primary hover:bg-primary/90 text-white">
                        <Mail className="h-4 w-4" />
                        Send to Client
                    </Button>
                </div>
            </div>

            {/* Invoice Document */}
            <Card className="bg-white text-black p-8 md:p-12 shadow-xl border-none tracking-normal font-sans">
                {/* Header */}
                <div className="flex justify-between items-start mb-12">
                    <div>
                        <h1 className="text-3xl font-bold text-black mb-1">INVOICE</h1>
                        <p className="text-sm text-gray-500 font-medium">#{invoice.id}</p>
                    </div>
                    <div className="text-right">
                        <h3 className="font-bold text-lg mb-1">{activeWorkspace.name}</h3>
                        <p className="text-sm text-gray-500">123 Business Rd</p>
                        <p className="text-sm text-gray-500">Tech City, CA 90210</p>
                        <p className="text-sm text-gray-500">billing@{activeWorkspace.id}.com</p>
                    </div>
                </div>

                {/* Client & Dates */}
                <div className="flex justify-between items-start mb-12">
                    <div>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Bill To</p>
                        <h4 className="font-bold text-lg">{client.company || client.name}</h4>
                        <p className="text-sm text-gray-600 max-w-[200px]">{client.address}</p>
                        <p className="text-sm text-gray-600 mt-1">{client.email}</p>
                    </div>
                    <div className="text-right space-y-2">
                        <div>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Issue Date</p>
                            <p className="font-medium">{invoice.issueDate}</p>
                        </div>
                        <div>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Due Date</p>
                            <p className="font-medium">{invoice.dueDate}</p>
                        </div>
                    </div>
                </div>

                {/* Items Table */}
                <table className="w-full mb-12">
                    <thead>
                        <tr className="border-b-2 border-black">
                            <th className="text-left font-bold py-3 uppercase text-xs tracking-wider">Description</th>
                            <th className="text-right font-bold py-3 uppercase text-xs tracking-wider">Qty</th>
                            <th className="text-right font-bold py-3 uppercase text-xs tracking-wider">Price</th>
                            <th className="text-right font-bold py-3 uppercase text-xs tracking-wider">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoice.items.map((item, i) => (
                            <tr key={i} className="border-b border-gray-200">
                                <td className="py-4 text-sm font-medium">{item.description}</td>
                                <td className="py-4 text-sm text-right text-gray-600">{item.quantity}</td>
                                <td className="py-4 text-sm text-right text-gray-600">${item.price.toFixed(2)}</td>
                                <td className="py-4 text-sm text-right font-bold">${(item.quantity * item.price).toFixed(2)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {/* Totals */}
                <div className="flex justify-end mb-12">
                    <div className="w-1/2 space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Subtotal</span>
                            <span className="font-medium">${invoice.subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Tax (10%)</span>
                            <span className="font-medium">${invoice.tax.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-lg font-bold border-t-2 border-black pt-2 mt-2">
                            <span>Total</span>
                            <span>${invoice.total.toFixed(2)}</span>
                        </div>
                    </div>
                </div>

                {/* Notes */}
                {invoice.notes && (
                    <div className="border-t border-gray-200 pt-6">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Notes</p>
                        <p className="text-sm text-gray-600">{invoice.notes}</p>
                    </div>
                )}
            </Card>
        </div>
    )
}
