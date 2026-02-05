"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'
import { Client, Invoice, InvoiceItem, InvoiceStatus, TaxCode, Account } from '@/lib/types/finance'
import { createClient } from '@/lib/supabase/client'
import { useWorkspace } from './workspace-context'
import { UserRole } from '@/lib/types/tool-registry'

// --- Types ---
export type InventoryItem = {
    id: string
    name: string
    sku: string
    quantity: number
    unit: string
    category: string
    minLevel: number
    cost: number
    price: number
    expiry: string
    batch: string
}

export type Transaction = {
    id: string
    workspaceId: string
    date: string
    amount: number
    type: 'income' | 'expense'
    category: string
    description: string
    status: 'completed' | 'pending' | 'posted' | 'processing' | 'failed'
    taxCode?: TaxCode
    payee?: string
    paymentMethod?: string
    accountId?: string
}

export type Order = {
    id: string
    tableId: string
    items: { name: string; quantity: number; price: number }[]
    status: 'pending' | 'preparing' | 'ready' | 'delivered' | 'completed' | 'refunded' | 'cancelled'
    total: number
    timestamp: Date
    type: 'dine-in' | 'delivery'
    source: 'pos' | 'uber' | 'doordash' | 'kiosk'
    customer?: string
    externalId?: string
}

export type UserLink = {
    id: string
    workspaceId: string
    personalUserId: string
    businessUserId: string
    status: 'active' | 'suspended'
    employeeId: string
    personalEmail: string // For display
}


interface MockDatabaseContextType {
    inventory: InventoryItem[]
    transactions: Transaction[]
    orders: Order[]
    clients: Client[]
    invoices: Invoice[]
    accounts: Account[]
    userLinks: UserLink[]
    permissions: Record<string, UserRole[]>
    togglePermission: (toolId: string, role: UserRole) => void

    // Actions
    // Actions
    addTransaction: (tx: Omit<Transaction, 'id' | 'date'>) => Promise<void>
    addInventoryItem: (item: Omit<InventoryItem, 'id'>) => Promise<void>
    updateInventory: (id: string, newQuantity: number) => Promise<void>
    updateInventoryItem: (id: string, updates: Partial<InventoryItem>) => Promise<void>
    deleteInventoryItem: (id: string) => Promise<void>
    decrementStock: (itemName: string, count: number) => Promise<void>
    createOrder: (order: Omit<Order, 'id' | 'timestamp'>) => void
    updateOrderStatus: (id: string, status: Order['status']) => void

    // Finance Actions
    addClient: (client: Omit<Client, 'id'>) => void
    updateClient: (id: string, updates: Partial<Client>) => void
    deleteClient: (id: string) => void
    createInvoice: (invoice: Omit<Invoice, 'id'>) => void
    updateInvoiceStatus: (id: string, status: InvoiceStatus) => void
    addAccount: (account: Omit<Account, 'id'>) => Promise<void>
    linkUser: (link: Omit<UserLink, 'id'>) => Promise<void>
    generateEmployeeId: (firstName: string, lastName: string) => Promise<string>
}

// --- Initial Data ---
const INITIAL_INVENTORY: InventoryItem[] = [
    { id: '1', name: 'Arabica Coffee Beans', sku: 'BEANS-001', quantity: 12, unit: 'kg', category: 'Raw Material', minLevel: 5, cost: 15.00, price: 0, expiry: '2024-06-01', batch: 'B101' },
    { id: '2', name: 'Whole Milk', sku: 'DAIRY-001', quantity: 8, unit: 'L', category: 'Dairy', minLevel: 10, cost: 1.50, price: 0, expiry: '2024-02-15', batch: 'B102' },
    { id: '3', name: 'Avocados', sku: 'PROD-001', quantity: 45, unit: 'pcs', category: 'Produce', minLevel: 20, cost: 0.80, price: 0, expiry: '2024-02-10', batch: 'B103' },
    { id: '4', name: 'Sourdough Bread', sku: 'BAKE-001', quantity: 5, unit: 'loaves', category: 'Bakery', minLevel: 8, cost: 2.50, price: 0, expiry: '2024-02-08', batch: 'B104' },
]

const INITIAL_CLIENTS: Client[] = [
    { id: 'c1', workspaceId: 'ws-deli', name: 'Alice Corp', email: 'billing@alice.com', phone: '555-0101', address: '123 Wonderland Ave', company: 'Alice Corp' },
    { id: 'c2', workspaceId: 'ws-deli', name: 'Bob Industries', email: 'accounts@bobind.com', phone: '555-0102', address: '456 Builder Ln', company: 'Bob Industries' },
]

const INITIAL_INVOICES: Invoice[] = [
    {
        id: 'INV-001',
        workspaceId: 'ws-deli',
        clientId: 'c1',
        items: [{ id: 'i1', description: 'Consulting', quantity: 10, price: 150 }],
        status: 'Paid',
        issueDate: '2024-01-10',
        dueDate: '2024-01-24',
        subtotal: 1500,
        tax: 150,
        total: 1650
    }
]

const INITIAL_ORDERS: Order[] = []

const MockDatabaseContext = createContext<MockDatabaseContextType | undefined>(undefined)

export function MockDatabaseProvider({ children }: { children: React.ReactNode }) {
    const supabase = createClient()
    const { activeWorkspace } = useWorkspace() // To refetch when workspace changes

    const [inventory, setInventory] = useState<InventoryItem[]>(INITIAL_INVENTORY)
    const [transactions, setTransactions] = useState<Transaction[]>([])
    const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS)
    const [clients, setClients] = useState<Client[]>(INITIAL_CLIENTS)
    const [invoices, setInvoices] = useState<Invoice[]>(INITIAL_INVOICES)
    const [accounts, setAccounts] = useState<Account[]>([])
    const [userLinks, setUserLinks] = useState<UserLink[]>([])

    // Default Permissions (Everyone has access to everything for now in mock)
    const [permissions, setPermissions] = useState<Record<string, UserRole[]>>({})

    // Load Data from Supabase
    useEffect(() => {
        const fetchData = async () => {
            if (!supabase || !activeWorkspace?.id) return

            // Fetch Transactions
            const { data: txData, error: txError } = await supabase
                .from('transactions')
                .select('*')
                .order('date', { ascending: false })

            if (txError) console.error('Error fetching transactions:', txError)

            if (txData) {
                const mappedTx: Transaction[] = txData.map(t => ({
                    id: t.id,
                    workspaceId: t.workspace_id,
                    date: t.date,
                    amount: t.amount,
                    type: t.type,
                    category: t.category,
                    description: t.description || t.payee,
                    status: t.status,
                    payee: t.payee,
                    paymentMethod: t.payment_method,
                    accountId: t.account_id
                }))
                setTransactions(mappedTx)
            }

            // Fetch Accounts
            const { data: accData, error: accError } = await supabase
                .from('accounts')
                .select('*')

            if (accError) console.error('Error fetching accounts:', accError)

            if (accData) {
                const mappedAcc: Account[] = accData.map(a => ({
                    id: a.id,
                    workspaceId: a.workspace_id,
                    name: a.name,
                    institution: a.institution,
                    type: a.type,
                    balance: a.balance,
                    color: a.color
                }))
                setAccounts(mappedAcc)
            }
            // Fetch Inventory
            const { data: invData, error: invError } = await supabase
                .from('inventory_items')
                .select('*')
                .eq('workspace_id', activeWorkspace.id)
                .order('name')

            if (invError) console.error('Error fetching inventory:', invError)

            if (invData) {
                setInventory(invData.map(i => ({
                    id: i.id,
                    name: i.name,
                    sku: i.sku || '',
                    quantity: i.quantity,
                    unit: i.unit,
                    category: i.category,
                    minLevel: i.min_level,
                    cost: i.cost,
                    price: i.price,
                    expiry: i.expiry,
                    batch: i.batch
                })))
            }
        }

        fetchData()
    }, [activeWorkspace?.id])






    // Actions
    const addTransaction = async (tx: Omit<Transaction, 'id' | 'date'>) => {
        // Optimistic Update
        const tempId = Math.random().toString(36).substr(2, 9)
        const date = new Date().toISOString()
        const newTx: Transaction = { ...tx, id: tempId, date }

        setTransactions(prev => [newTx, ...prev])

        // DB Insert
        if (!supabase) return

        const { data, error } = await supabase.from('transactions').insert({
            workspace_id: tx.workspaceId,
            date: date,
            payee: tx.payee || tx.description || 'Unknown',
            amount: tx.amount,
            category: tx.category,
            status: tx.status === 'completed' ? 'posted' : tx.status,
            type: tx.type,
            payment_method: tx.paymentMethod,
            description: tx.description,
            account_id: tx.accountId
        }).select().single()

        if (error) {
            console.error('Error adding transaction:', error)
            setTransactions(prev => prev.filter(t => t.id !== tempId))
        } else if (data) {
            setTransactions(prev => prev.map(t => t.id === tempId ? { ...t, id: data.id } : t))
        }
    }

    const addAccount = async (account: Omit<Account, 'id'>) => {
        if (!activeWorkspace?.id) return

        const tempId = Math.random().toString(36).substr(2, 9)
        const newAccount: Account = { ...account, id: tempId }
        setAccounts(prev => [...prev, newAccount])

        if (supabase) {
            const { data, error } = await supabase.from('accounts').insert({
                workspace_id: activeWorkspace.id,
                name: account.name,
                institution: account.institution,
                type: account.type,
                balance: account.balance,
                color: account.color
            }).select().single()

            if (error) {
                console.error('Error adding account:', error)
                setAccounts(prev => prev.filter(a => a.id !== tempId))
            } else if (data) {
                setAccounts(prev => prev.map(a => a.id === tempId ? { ...a, id: data.id } : a))
            }
        }
    }

    const addInventoryItem = async (item: Omit<InventoryItem, 'id'>) => {
        if (!activeWorkspace?.id) {
            console.error('No active workspace found when adding inventory')
            return
        }

        const tempId = Math.random().toString(36).substr(2, 9)
        const newItem = { ...item, id: tempId }
        setInventory(prev => [...prev, newItem])

        if (supabase) {
            const { data, error } = await supabase.from('inventory_items').insert({
                workspace_id: activeWorkspace.id,
                name: item.name,
                sku: item.sku,
                quantity: item.quantity,
                unit: item.unit,
                category: item.category,
                min_level: item.minLevel,
                cost: item.cost,
                price: item.price,
                expiry: item.expiry || null, // Handle empty string
                batch: item.batch
            }).select().single()

            if (error) {
                console.error('Error adding inventory:', error)
                setInventory(prev => prev.filter(i => i.id !== tempId))
            } else if (data) {
                setInventory(prev => prev.map(i => i.id === tempId ? { ...i, id: data.id } : i))
            }
        }
    }

    const updateInventory = async (id: string, newQuantity: number) => {
        setInventory(prev => prev.map(item =>
            item.id === id ? { ...item, quantity: newQuantity } : item
        ))

        if (supabase) {
            const { error } = await supabase.from('inventory_items').update({ quantity: newQuantity }).eq('id', id)
            if (error) console.error('Error updating inventory:', error)
        }
    }

    const updateInventoryItem = async (id: string, updates: Partial<InventoryItem>) => {
        setInventory(prev => prev.map(item =>
            item.id === id ? { ...item, ...updates } : item
        ))

        if (supabase) {
            // Map frontend fields to DB columns if necessary
            const dbUpdates: any = {}
            if (updates.name !== undefined) dbUpdates.name = updates.name
            if (updates.sku !== undefined) dbUpdates.sku = updates.sku
            if (updates.quantity !== undefined) dbUpdates.quantity = updates.quantity
            if (updates.unit !== undefined) dbUpdates.unit = updates.unit
            if (updates.category !== undefined) dbUpdates.category = updates.category
            if (updates.minLevel !== undefined) dbUpdates.min_level = updates.minLevel
            if (updates.cost !== undefined) dbUpdates.cost = updates.cost
            if (updates.price !== undefined) dbUpdates.price = updates.price
            if (updates.expiry !== undefined) dbUpdates.expiry = updates.expiry
            if (updates.batch !== undefined) dbUpdates.batch = updates.batch

            const { error } = await supabase.from('inventory_items').update(dbUpdates).eq('id', id)
            if (error) console.error('Error updating inventory item:', error)
        }
    }

    const deleteInventoryItem = async (id: string) => {
        setInventory(prev => prev.filter(i => i.id !== id))
        if (supabase) {
            const { error } = await supabase.from('inventory_items').delete().eq('id', id)
            if (error) console.error('Error deleting inventory item:', error)
        }
    }

    const decrementStock = async (itemName: string, count: number) => {
        // Find item locally first for optimistic update
        // Note: fuzzy matching logic from before is a bit risky for real DB, but keeping for compatibility with "Coffee" vs "Arabica Coffee Beans" logic
        setInventory(prev => prev.map(item => {
            if (item.name.toLowerCase().includes(itemName.toLowerCase())) { // Simplified check
                const newQty = Math.max(0, item.quantity - count)
                // Trigger async update (fire and forget for now, ideally strictly serialized)
                if (supabase) {
                    supabase.from('inventory_items').update({ quantity: newQty }).eq('id', item.id).then(({ error }) => {
                        if (error) console.error('Error decrementing stock:', error)
                    })
                }
                return { ...item, quantity: newQty }
            }
            return item
        }))
    }

    const createOrder = (order: Omit<Order, 'id' | 'timestamp'>) => {
        const newOrder: Order = {
            ...order,
            id: Math.random().toString(36).substr(2, 9),
            timestamp: new Date()
        }
        setOrders(prev => [newOrder, ...prev])

        if (newOrder.status !== 'cancelled') {
            addTransaction({
                workspaceId: 'ws-deli',
                amount: order.total,
                type: 'income',
                category: 'Sales',
                description: `Order #${newOrder.id} (${order.source})`,
                status: 'completed',
                payee: 'POS Customer'
            })
        }

        order.items.forEach(item => {
            if (item.name.includes("Coffee")) decrementStock("Arabica Coffee Beans", 0.02 * item.quantity)
            if (item.name.includes("Latte")) decrementStock("Whole Milk", 0.2 * item.quantity)
            if (item.name.includes("Avocado")) decrementStock("Avocados", 1 * item.quantity)
        })
    }

    const updateOrderStatus = (id: string, status: Order['status']) => {
        setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o))
    }

    // --- Finance Actions ---
    const addClient = (client: Omit<Client, 'id'>) => {
        const newClient: Client = {
            ...client,
            id: Math.random().toString(36).substr(2, 9)
        }
        setClients(prev => [...prev, newClient])
    }

    const updateClient = (id: string, updates: Partial<Client>) => {
        setClients(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
    }

    const deleteClient = (id: string) => {
        setClients(prev => prev.filter(c => c.id !== id))
    }

    const createInvoice = (invoice: Omit<Invoice, 'id'>) => {
        const id = `INV-${new Date().getFullYear()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
        const newInvoice: Invoice = {
            ...invoice,
            id
        }
        setInvoices(prev => [newInvoice, ...prev])
    }

    const updateInvoiceStatus = (id: string, status: InvoiceStatus) => {
        setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, status } : inv))
    }

    const generateEmployeeId = async (firstName: string, lastName: string) => {
        // Mock logic: 2 chars of first name + last name + 4 random digits
        const prefix = (firstName.substring(0, 2) + lastName).toLowerCase().replace(/[^a-z]/g, '')
        const suffix = Math.floor(1000 + Math.random() * 9000)
        return `${prefix}${suffix}`
    }

    const linkUser = async (link: Omit<UserLink, 'id'>) => {
        const newLink: UserLink = {
            ...link,
            id: `lnk_${Date.now()}`
        }
        setUserLinks(prev => [...prev, newLink])

        // In real app, this would call Supabase to create the user_links row
        // await supabase.from('user_links').insert(...)
    }

    const togglePermission = (toolId: string, role: UserRole) => {
        setPermissions(prev => {
            const current = prev[toolId] || []
            if (current.includes(role)) {
                return { ...prev, [toolId]: current.filter(r => r !== role) }
            } else {
                return { ...prev, [toolId]: [...current, role] }
            }
        })
    }

    return (
        <MockDatabaseContext.Provider value={{
            inventory,
            transactions,
            orders,
            clients,
            invoices,
            accounts,
            addAccount,
            addTransaction,
            addInventoryItem,
            updateInventory,
            updateInventoryItem,
            deleteInventoryItem,
            decrementStock,
            createOrder,
            updateOrderStatus,
            addClient,
            updateClient,
            deleteClient,
            createInvoice,
            updateInvoiceStatus,
            userLinks,
            linkUser,
            generateEmployeeId,
            permissions,
            togglePermission
        }}>
            {children}
        </MockDatabaseContext.Provider>
    )
}

export function useMockDatabase() {
    const context = useContext(MockDatabaseContext)
    if (context === undefined) {
        throw new Error('useMockDatabase must be used within a MockDatabaseProvider')
    }
    return context
}
