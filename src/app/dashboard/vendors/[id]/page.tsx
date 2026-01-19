"use client"

import React, { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import {
    ChevronLeft,
    Upload,
    FileText,
    MoreHorizontal,
    Download,
    Mail,
    Phone,
    MapPin,
    ExternalLink,
    Receipt,
    History
} from 'lucide-react'
import { cn } from "@/lib/utils"

import { VENDORS_DATA } from '@/lib/mock-data'

export default function VendorDetailsPage() {
    const params = useParams()
    const router = useRouter()
    const vendorId = Number(params.id)

    const [activeTab, setActiveTab] = useState("overview")

    // Mock Data (Shared with list page for consistency)

    const vendor = VENDORS_DATA.find(v => v.id === vendorId) || VENDORS_DATA[0] // Fallback to first if not found

    const documents = [
        { id: 1, name: "Invoice #INV-2024-001.pdf", date: "2024-01-15", size: "245 KB", type: "Invoice" },
        { id: 2, name: "Contract_Agreement_2024.pdf", date: "2023-12-20", size: "1.2 MB", type: "Contract" },
        { id: 3, name: "Statement_Dec_2023.pdf", date: "2024-01-01", size: "180 KB", type: "Statement" },
    ]

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.back()}>
                    <ChevronLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
                        {vendor.name}
                        <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10">
                            {vendor.status}
                        </Badge>
                    </h2>
                    <p className="text-muted-foreground">{vendor.type}</p>
                </div>
                <div className="ml-auto flex gap-2">
                    <Button variant="outline" className="border-white/10">Edit Profile</Button>
                    <Button className="bg-primary hover:bg-primary/90 text-white">Create Purchase Order</Button>
                </div>
            </div>

            <Tabs defaultValue="overview" className="space-y-4" onValueChange={setActiveTab}>
                <TabsList className="bg-black/40 border border-white/10">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="documents">Documents</TabsTrigger>
                    <TabsTrigger value="transactions">Transactions</TabsTrigger>
                </TabsList>

                {/* Overview Tab */}
                <TabsContent value="overview" className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Outstanding Balance</CardTitle>
                                <Receipt className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-white">${vendor.balance.toLocaleString()}</div>
                                <p className="text-xs text-muted-foreground">Due by Jan 30, 2024</p>
                            </CardContent>
                        </Card>
                        <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Last Payment</CardTitle>
                                <History className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-white">{vendor.lastPayment}</div>
                                <p className="text-xs text-muted-foreground">Amount: ${vendor.lastPaymentAmount.toLocaleString()}</p>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                        <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                            <CardHeader>
                                <CardTitle>Contact Information</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded bg-white/10 flex items-center justify-center">
                                        <Mail className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div className="space-y-0.5">
                                        <div className="text-sm font-medium text-white">Email</div>
                                        <div className="text-xs text-muted-foreground">{vendor.email}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded bg-white/10 flex items-center justify-center">
                                        <Phone className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div className="space-y-0.5">
                                        <div className="text-sm font-medium text-white">Phone</div>
                                        <div className="text-xs text-muted-foreground">{vendor.phone}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded bg-white/10 flex items-center justify-center">
                                        <MapPin className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div className="space-y-0.5">
                                        <div className="text-sm font-medium text-white">Address</div>
                                        <div className="text-xs text-muted-foreground">{vendor.address}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded bg-white/10 flex items-center justify-center">
                                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div className="space-y-0.5">
                                        <div className="text-sm font-medium text-white">Website</div>
                                        <a href={vendor.website} target="_blank" className="text-xs text-primary hover:underline">{vendor.website}</a>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                {/* Documents Tab */}
                <TabsContent value="documents" className="space-y-4">
                    <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                        <CardContent className="p-6">
                            <div className="border-2 border-dashed border-white/10 rounded-lg p-8 flex flex-col items-center justify-center text-center hover:bg-white/5 transition-colors cursor-pointer">
                                <div className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center mb-4">
                                    <Upload className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <h3 className="text-lg font-medium text-white mb-1">Upload Files</h3>
                                <p className="text-sm text-muted-foreground max-w-xs mb-4">
                                    Drag and drop invoices, statements, or contracts here.
                                </p>
                                <Button size="sm" variant="outline" className="border-white/10">Select Files</Button>
                            </div>

                            <div className="mt-6 space-y-3">
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Recent Documents</h3>
                                {documents.map((doc) => (
                                    <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg border border-white/5 bg-white/5 hover:bg-white/10 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="h-10 w-10 rounded bg-blue-500/20 flex items-center justify-center text-blue-400">
                                                <FileText className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-white">{doc.name}</p>
                                                <p className="text-xs text-muted-foreground">{doc.type} • {doc.size} • {doc.date}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-white">
                                                <Download className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-white">
                                                <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Transactions Tab (Placeholder) */}
                <TabsContent value="transactions">
                    <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                        <CardContent className="p-6 text-center text-muted-foreground">
                            Transaction history for {vendor.name} would appear here.
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
