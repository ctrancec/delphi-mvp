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
    Plus,
    Search,
    MoreHorizontal,
    FileText,
    DollarSign,
    Calendar,
    CheckCircle2,
    Clock,
    AlertCircle,
    Download,
    Send
} from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { useMockDatabase } from '@/lib/contexts/mock-db-context'

export default function InvoicesPage() {
    const { invoices, clients } = useMockDatabase()
    const [searchTerm, setSearchTerm] = useState('')

    // Helper to get client name
    const getClientName = (id: string) => {
        const client = clients.find(c => c.id === id)
        return client ? (client.company || client.name) : 'Unknown Client'
    }

    const filteredInvoices = invoices.filter(inv => {
        const clientName = getClientName(inv.clientId).toLowerCase()
        return clientName.includes(searchTerm.toLowerCase()) ||
            inv.id.toLowerCase().includes(searchTerm.toLowerCase())
    })

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Paid': return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
            case 'Pending': return "bg-blue-500/10 text-blue-500 border-blue-500/20"
            case 'Overdue': return "bg-red-500/10 text-red-500 border-red-500/20"
            default: return "bg-white/10 text-muted-foreground border-white/10"
        }
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'Paid': return <CheckCircle2 className="h-3 w-3 mr-1" />
            case 'Pending': return <Clock className="h-3 w-3 mr-1" />
            case 'Overdue': return <AlertCircle className="h-3 w-3 mr-1" />
            default: return <FileText className="h-3 w-3 mr-1" />
        }
    }

    // Calculate details for KPIs
    const outstandingAmount = invoices
        .filter(i => i.status === 'Pending' || i.status === 'Overdue')
        .reduce((acc, curr) => acc + curr.total, 0)

    const overdueAmount = invoices
        .filter(i => i.status === 'Overdue')
        .reduce((acc, curr) => acc + curr.total, 0)

    const paidAmount = invoices
        .filter(i => i.status === 'Paid')
        .reduce((acc, curr) => acc + curr.total, 0)

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Invoices</h2>
                    <p className="text-muted-foreground">
                        Create and manage client invoices and payments.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" className="gap-2">
                        <Download className="h-4 w-4" />
                        Export Report
                    </Button>
                    <Link href="/dashboard/invoices/new">
                        <Button className="gap-2 bg-primary hover:bg-primary/90 text-white">
                            <Plus className="h-4 w-4" />
                            Create Invoice
                        </Button>
                    </Link>
                </div>
            </div>

            {/* KPIs */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Outstanding</CardTitle>
                        <Clock className="h-4 w-4 text-blue-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">${outstandingAmount.toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground">Total pending payments</p>
                    </CardContent>
                </Card>
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Overdue</CardTitle>
                        <AlertCircle className="h-4 w-4 text-red-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">${overdueAmount.toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground">Requires attention</p>
                    </CardContent>
                </Card>
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Paid (This Month)</CardTitle>
                        <DollarSign className="h-4 w-4 text-emerald-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">${paidAmount.toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground">Lifetime earnings</p>
                    </CardContent>
                </Card>
            </div>

            {/* Invoices List */}
            <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Invoice History</CardTitle>
                            <CardDescription>
                                A list of all issued invoices.
                            </CardDescription>
                        </div>
                        <div className="relative w-64">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search client or ID..."
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
                                <TableHead className="text-white">Invoice ID</TableHead>
                                <TableHead className="text-white">Client</TableHead>
                                <TableHead className="text-white">Amount</TableHead>
                                <TableHead className="text-white">Status</TableHead>
                                <TableHead className="text-white">Issued Date</TableHead>
                                <TableHead className="text-white">Due Date</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredInvoices.length === 0 ? (
                                <TableRow className="border-white/10">
                                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                        No invoices found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredInvoices.map((inv) => (
                                    <TableRow key={inv.id} className="border-white/10 hover:bg-white/5">
                                        <TableCell className="font-medium text-white font-mono text-xs">
                                            <Link href={`/dashboard/invoices/${inv.id}`} className="hover:underline hover:text-primary">
                                                {inv.id}
                                            </Link>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="text-white font-medium">{getClientName(inv.clientId)}</span>
                                                <span className="text-xs text-muted-foreground">{inv.items.length} items</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-white font-medium">${inv.total.toLocaleString()}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={cn("border", getStatusColor(inv.status))}>
                                                {getStatusIcon(inv.status)}
                                                {inv.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-sm">{inv.issueDate}</TableCell>
                                        <TableCell className="text-muted-foreground text-sm">{inv.dueDate}</TableCell>
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
                                                        <Send className="h-3 w-3" /> Send to Client
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem className="hover:bg-white/10 cursor-pointer gap-2">
                                                        <Download className="h-3 w-3" /> Download PDF
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator className="bg-white/10" />
                                                    <DropdownMenuItem className="hover:bg-white/10 cursor-pointer text-blue-400">Mark as Paid</DropdownMenuItem>
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
