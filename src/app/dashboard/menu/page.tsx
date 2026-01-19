"use client"

import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
    Plus,
    Search,
    Filter,
    Edit2,
    Trash2,
    Image as ImageIcon,
    MoreHorizontal,
    Check
} from 'lucide-react'
import { cn } from "@/lib/utils"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { UnifiedMenuItem, MenuItemStatus } from "@/lib/types/menu"
import { INITIAL_MENU_DATA } from "@/lib/data/menu-data"

export default function MenuPage() {
    const [menuItems, setMenuItems] = useState<UnifiedMenuItem[]>(INITIAL_MENU_DATA)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState('')
    const [filterCategory, setFilterCategory] = useState('all')

    // Form State
    const [editingItem, setEditingItem] = useState<UnifiedMenuItem | null>(null)
    const [formData, setFormData] = useState({
        name: '',
        category: 'Food',
        price: '',
        stock: '',
        image: '',
        status: 'active' as MenuItemStatus
    })

    const openCreateDialog = () => {
        setEditingItem(null)
        setFormData({ name: '', category: 'Food', price: '', stock: '', image: '', status: 'active' })
        setIsDialogOpen(true)
    }

    const openEditDialog = (item: UnifiedMenuItem) => {
        setEditingItem(item)
        setFormData({
            name: item.name,
            category: item.category,
            price: item.price.toString(),
            stock: item.stock.toString(),
            image: item.image || '',
            status: item.status
        })
        setIsDialogOpen(true)
    }

    const handleSave = () => {
        if (!formData.name) return

        const price = parseFloat(formData.price) || 0
        const stock = parseInt(formData.stock) || 0

        if (editingItem) {
            // Update
            setMenuItems(prev => prev.map(item => item.id === editingItem.id ? {
                ...item,
                name: formData.name,
                category: formData.category,
                price,
                stock,
                image: formData.image,
                status: formData.status
            } : item))
        } else {
            // Create
            const newItem: UnifiedMenuItem = {
                id: (Math.random() * 10000).toFixed(0),
                name: formData.name,
                category: formData.category,
                price,
                stock,
                image: formData.image || '🍽️',
                status: formData.status
            }
            setMenuItems(prev => [...prev, newItem])
        }
        setIsDialogOpen(false)
    }

    const handleDelete = (id: string) => {
        setMenuItems(prev => prev.filter(i => i.id !== id))
    }

    const filteredItems = menuItems.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase())
        const matchesCategory = filterCategory === 'all' || item.category === filterCategory
        return matchesSearch && matchesCategory
    })

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Menu Management</h2>
                    <p className="text-muted-foreground">
                        Manage your product catalog, prices, and inventory.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={openCreateDialog} className="gap-2 bg-primary hover:bg-primary/90 text-white">
                        <Plus className="h-4 w-4" />
                        Add Item
                    </Button>
                </div>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-[500px] bg-zinc-950 border-white/10 text-white z-[9999]">
                    <DialogHeader>
                        <DialogTitle>{editingItem ? 'Edit Item' : 'Add New Item'}</DialogTitle>
                        <DialogDescription className="text-gray-400">
                            {editingItem ? 'Update product details.' : 'Create a new product for your menu.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="name" className="text-right">Name</Label>
                            <Input
                                id="name"
                                className="col-span-3 bg-white/5 border-white/10 text-white"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="category" className="text-right">Category</Label>
                            <Select
                                value={formData.category}
                                onValueChange={(v) => setFormData({ ...formData, category: v })}
                            >
                                <SelectTrigger className="col-span-3 bg-white/5 border-white/10 text-white">
                                    <SelectValue placeholder="Category" />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-950 border-white/10 text-white">
                                    <SelectItem value="Food">Food</SelectItem>
                                    <SelectItem value="Beverages">Beverages</SelectItem>
                                    <SelectItem value="Retail">Retail</SelectItem>
                                    <SelectItem value="Merch">Merch</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="price" className="text-right">Price ($)</Label>
                            <Input
                                id="price"
                                type="number"
                                className="col-span-3 bg-white/5 border-white/10 text-white"
                                value={formData.price}
                                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="stock" className="text-right">Stock</Label>
                            <Input
                                id="stock"
                                type="number"
                                className="col-span-3 bg-white/5 border-white/10 text-white"
                                value={formData.stock}
                                onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="status" className="text-right">Status</Label>
                            <Select
                                value={formData.status}
                                onValueChange={(v: MenuItemStatus) => setFormData({ ...formData, status: v })}
                            >
                                <SelectTrigger className="col-span-3 bg-white/5 border-white/10 text-white">
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-950 border-white/10 text-white">
                                    <SelectItem value="active">Active</SelectItem>
                                    <SelectItem value="out_of_stock">Out of Stock</SelectItem>
                                    <SelectItem value="archived">Archived</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="submit" onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                            {editingItem ? 'Update Item' : 'Create Item'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Total Items</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{menuItems.length}</div>
                        <p className="text-xs text-muted-foreground mt-1">Across 4 categories</p>
                    </CardContent>
                </Card>
                <Card className="bg-white/5 border-white/10 backdrop-blur-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Low Stock Alerts</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">
                            {menuItems.filter(i => i.stock < 15 && i.status === 'active').length}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 text-yellow-400">Restock recommended</p>
                    </CardContent>
                </Card>
            </div>

            <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                <div className="p-4 flex items-center gap-4 border-b border-white/10">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="search"
                            placeholder="Search menu items..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 bg-white/5 border-white/10 text-white focus-visible:ring-primary/20"
                        />
                    </div>
                    <Select value={filterCategory} onValueChange={setFilterCategory}>
                        <SelectTrigger className="w-[180px] bg-white/5 border-white/10 text-white">
                            <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-950 border-white/10 text-white">
                            <SelectItem value="all">All Categories</SelectItem>
                            <SelectItem value="Food">Food</SelectItem>
                            <SelectItem value="Beverages">Beverages</SelectItem>
                            <SelectItem value="Retail">Retail</SelectItem>
                            <SelectItem value="Merch">Merch</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="relative w-full overflow-auto">
                    <table className="w-full caption-bottom text-sm text-left">
                        <thead className="[&_tr]:border-b [&_tr]:border-white/10">
                            <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                                <th className="h-12 px-4 align-middle font-medium text-muted-foreground w-[80px]">Image</th>
                                <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Name</th>
                                <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Category</th>
                                <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Price</th>
                                <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Stock</th>
                                <th className="h-12 px-4 align-middle font-medium text-muted-foreground">Status</th>
                                <th className="h-12 px-4 align-middle font-medium text-muted-foreground w-[50px]">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="[&_tr:last-child]:border-0">
                            {filteredItems.map((item) => (
                                <tr key={item.id} className="border-b border-white/5 transition-colors hover:bg-white/5">
                                    <td className="p-4 align-middle">
                                        <div className="h-10 w-10 rounded bg-white/10 flex items-center justify-center text-xl select-none">
                                            {item.image || <ImageIcon className="h-5 w-5 text-muted-foreground" />}
                                        </div>
                                    </td>
                                    <td className="p-4 align-middle font-medium text-white max-w-[200px] truncate" title={item.name}>{item.name}</td>
                                    <td className="p-4 align-middle text-muted-foreground">{item.category}</td>
                                    <td className="p-4 align-middle font-medium text-white">${item.price.toFixed(2)}</td>
                                    <td className="p-4 align-middle text-muted-foreground">{item.stock}</td>
                                    <td className="p-4 align-middle">
                                        <Badge variant="secondary" className={cn(
                                            "border-0 capitalize",
                                            item.status === 'active' && "bg-emerald-500/10 text-emerald-500",
                                            item.status === 'out_of_stock' && "bg-red-500/10 text-red-500",
                                            item.status === 'archived' && "bg-gray-500/10 text-gray-400",
                                        )}>
                                            {item.status.replace(/_/g, ' ')}
                                        </Badge>
                                    </td>
                                    <td className="p-4 align-middle">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-white">
                                                    <span className="sr-only">Open menu</span>
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="bg-zinc-950 border-white/10 text-white">
                                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={() => openEditDialog(item)} className="hover:bg-white/10 cursor-pointer gap-2">
                                                    <Edit2 className="h-3 w-3" /> Edit Item
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator className="bg-white/10" />
                                                <DropdownMenuItem onClick={() => handleDelete(item.id)} className="hover:bg-red-900/20 text-red-400 hover:text-red-300 cursor-pointer gap-2">
                                                    <Trash2 className="h-3 w-3" /> Delete
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    )
}
