"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'
import { Client, Invoice, InvoiceItem, InvoiceStatus, TaxCode } from '@/lib/types/finance'

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
    status: 'completed' | 'pending'
    taxCode?: TaxCode
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


interface MockDatabaseContextType {
    inventory: InventoryItem[]
    transactions: Transaction[]
    orders: Order[]
    clients: Client[]
    invoices: Invoice[]

    // Actions
    addTransaction: (tx: Omit<Transaction, 'id' | 'date'>) => void
    updateInventory: (id: string, newQuantity: number) => void
    decrementStock: (itemName: string, count: number) => void
    createOrder: (order: Omit<Order, 'id' | 'timestamp'>) => void
    updateOrderStatus: (id: string, status: Order['status']) => void

    // Finance Actions
    addClient: (client: Omit<Client, 'id'>) => void
    updateClient: (id: string, updates: Partial<Client>) => void
    deleteClient: (id: string) => void
    createInvoice: (invoice: Omit<Invoice, 'id'>) => void
    updateInvoiceStatus: (id: string, status: InvoiceStatus) => void
}

// --- Initial Data ---
const INITIAL_INVENTORY: InventoryItem[] = [
    { id: '1', name: 'Arabica Coffee Beans', sku: 'BEANS-001', quantity: 12, unit: 'kg', category: 'Raw Material', minLevel: 5, cost: 15.00, price: 0, expiry: '2024-06-01', batch: 'B101' },
    { id: '2', name: 'Whole Milk', sku: 'DAIRY-001', quantity: 8, unit: 'L', category: 'Dairy', minLevel: 10, cost: 1.50, price: 0, expiry: '2024-02-15', batch: 'B102' },
    { id: '3', name: 'Avocados', sku: 'PROD-001', quantity: 45, unit: 'pcs', category: 'Produce', minLevel: 20, cost: 0.80, price: 0, expiry: '2024-02-10', batch: 'B103' },
    { id: '4', name: 'Sourdough Bread', sku: 'BAKE-001', quantity: 5, unit: 'loaves', category: 'Bakery', minLevel: 8, cost: 2.50, price: 0, expiry: '2024-02-08', batch: 'B104' },
]

const INITIAL_TRANSACTIONS: Transaction[] = [
    // Deli Transactions
    { id: 't1', workspaceId: 'ws-deli', date: new Date().toISOString(), amount: 1200, type: 'income', category: 'Sales', description: 'Stripe Payout', status: 'completed' },
    { id: 't2', workspaceId: 'ws-deli', date: new Date(Date.now() - 86400000).toISOString(), amount: -145, type: 'expense', category: 'Software', description: 'AWS Bill', status: 'completed' },
    // Personal Transactions
    { id: 'p1', workspaceId: 'ws-personal', date: new Date().toISOString(), amount: -50, type: 'expense', category: 'Food', description: 'Grocery Run', status: 'completed' },
    { id: 'p2', workspaceId: 'ws-personal', date: new Date(Date.now() - 100000000).toISOString(), amount: 5000, type: 'income', category: 'Salary', description: 'Paycheck', status: 'completed' },
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
    const [inventory, setInventory] = useState<InventoryItem[]>(INITIAL_INVENTORY)
    const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_TRANSACTIONS)
    const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS)
    const [clients, setClients] = useState<Client[]>(INITIAL_CLIENTS)
    const [invoices, setInvoices] = useState<Invoice[]>(INITIAL_INVOICES)

    // --- Actions ---

    const addTransaction = (tx: Omit<Transaction, 'id' | 'date'>) => {
        const newTx: Transaction = {
            ...tx,
            id: Math.random().toString(36).substr(2, 9),
            date: new Date().toISOString()
        }
        setTransactions(prev => [newTx, ...prev])
    }

    const updateInventory = (id: string, newQuantity: number) => {
        setInventory(prev => prev.map(item =>
            item.id === id ? { ...item, quantity: newQuantity } : item
        ))
    }

    // Smart decrement: finds items by name (simple mock logic)
    const decrementStock = (itemName: string, count: number) => {
        // In a real app, this would use a Recipe mapping (Product -> Ingredients)
        // For this mock, we'll try to match name loosely or ignore if not found
        setInventory(prev => prev.map(item => {
            // Very simple partial match for demo purposes
            // e.g. "Avocado Toast" might decrement "Avocados"
            if (itemName.toLowerCase().includes(item.name.toLowerCase().split(' ')[0])) {
                return { ...item, quantity: Math.max(0, item.quantity - count) }
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

        // Auto-record sale transaction if confirmed/completed (Simulate instant payment for POS/Delivery for now)
        // In a real app, delivery orders might be paid out later (net 7/30 terms or weekly payouts)
        if (newOrder.status !== 'cancelled') {
            addTransaction({
                workspaceId: 'ws-deli', // POS orders always go to deli in this mock
                amount: order.total,
                type: 'income',
                category: 'Sales',
                description: `Order #${newOrder.id} (${order.source})`,
                status: 'completed'
            })
        }

        // Auto-decrement inventory (Simulated Recipes)
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
        // Generate a readable ID if not provided (simple counter)
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

    return (
        <MockDatabaseContext.Provider value={{
            inventory,
            transactions,
            orders,
            clients,
            invoices,
            addTransaction,
            updateInventory,
            decrementStock,
            createOrder,
            updateOrderStatus,
            addClient,
            updateClient,
            deleteClient,
            createInvoice,
            updateInvoiceStatus
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
