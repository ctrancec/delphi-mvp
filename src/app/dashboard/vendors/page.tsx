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
    Users,
    Plus,
    Search,
    MoreHorizontal,
    FileText,
    Mail,
    Phone,
    TrendingUp,
    Download
} from "lucide-react"
import { useState } from "react"

// Mock Data
const MOCK_VENDORS = [
    { id: 'v1', name: 'Sysco Foods', category: 'F&B Supply', contact: 'John Smith', email: 'john.s@sysco.com', status: 'Active', spendYTD: '$45,200', lastOrder: '2 days ago' },
    { id: 'v2', name: 'Restaurant Depot', category: 'Dry Goods', contact: 'Store Manager', email: 'support@rd.com', status: 'Active', spendYTD: '$12,450', lastOrder: '1 week ago' },
    { id: 'v3', name: 'Toast POS', category: 'Software', contact: 'Support', email: 'billing@toasttab.com', status: 'Active', spendYTD: '$3,600', lastOrder: '1 month ago' },
    { id: 'v4', name: 'Ecolab', category: 'Cleaning', contact: 'Sarah J.', email: 'sarah@ecolab.com', status: 'Review', spendYTD: '$2,100', lastOrder: '3 weeks ago' },
    { id: 'v5', name: 'Local Farm Co-op', category: 'Produce', contact: 'Mike Miller', email: 'mike@localfarm.org', status: 'Active', spendYTD: '$8,900', lastOrder: 'Yesterday' },
]

export default function VendorPage() {
    const [searchTerm, setSearchTerm] = useState('')

    const filteredVendors = MOCK_VENDORS.filter(v =>
        v.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        v.category.toLowerCase().includes(searchTerm.toLowerCase())
    )

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Vendor Analysis</h2>
                    <p className="text-muted-foreground">
                        Manage supplier relationships and track spending.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" className="gap-2">
                        <Download className="h-4 w-4" />
                        Export
                    </Button>
                    <Button className="gap-2 bg-primary hover:bg-primary/90 text-white">
                        <Plus className="h-4 w-4" />
                        Add Vendor
                    </Button>
                </div>
            </div>

            {/* KPIs */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Spend (YTD)</CardTitle>
                        <TrendingUp className="h-4 w-4 text-emerald-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">$72,250.00</div>
                        <p className="text-xs text-muted-foreground">+12% from last year</p>
                    </CardContent>
                </Card>
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Active Vendors</CardTitle>
                        <Users className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">14</div>
                        <p className="text-xs text-muted-foreground">2 pending review</p>
                    </CardContent>
                </Card>
            </div>

            {/* Vendor List */}
            <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Supplier Directory</CardTitle>
                            <CardDescription>
                                A list of all registered vendors and contractors.
                            </CardDescription>
                        </div>
                        <div className="relative w-64">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search vendors..."
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
                                <TableHead className="text-white">Vendor Name</TableHead>
                                <TableHead className="text-white">Category</TableHead>
                                <TableHead className="text-white">Contact</TableHead>
                                <TableHead className="text-white">Status</TableHead>
                                <TableHead className="text-white text-right">Spend (YTD)</TableHead>
                                <TableHead className="w-[50px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredVendors.map((vendor) => (
                                <TableRow key={vendor.id} className="border-white/10 hover:bg-white/5">
                                    <TableCell className="font-medium text-white">
                                        <div className="flex flex-col">
                                            <span>{vendor.name}</span>
                                            <span className="text-xs text-muted-foreground">{vendor.lastOrder}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="border-white/20 bg-white/5 text-muted-foreground">
                                            {vendor.category}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col text-sm text-muted-foreground">
                                            <div className="flex items-center gap-2">
                                                <Users className="h-3 w-3" />
                                                {vendor.contact}
                                            </div>
                                            <div className="flex items-center gap-2 mt-1 hover:text-primary cursor-pointer">
                                                <Mail className="h-3 w-3" />
                                                {vendor.email}
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge
                                            variant="secondary"
                                            className={
                                                vendor.status === 'Active' ? 'bg-emerald-500/10 text-emerald-500' :
                                                    'bg-yellow-500/10 text-yellow-500'
                                            }
                                        >
                                            {vendor.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-medium text-white">{vendor.spendYTD}</TableCell>
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
                                                <DropdownMenuItem className="hover:bg-white/10 cursor-pointer">View Details</DropdownMenuItem>
                                                <DropdownMenuItem className="hover:bg-white/10 cursor-pointer">View Invoices</DropdownMenuItem>
                                                <DropdownMenuSeparator className="bg-white/10" />
                                                <DropdownMenuItem className="hover:bg-white/10 cursor-pointer text-red-500">Deactivate</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
