export type Client = {
    id: string
    workspaceId: string
    name: string
    email: string
    phone: string
    address: string
    company: string
    notes?: string
}

export type TaxCode = 'standard' | 'gst_only' | 'exempt' | 'zero_rated'

export type InvoiceItem = {
    id: string
    description: string
    quantity: number
    price: number
    taxCode?: TaxCode // Optional for backward compatibility/simplicity
}

export type InvoiceStatus = 'Draft' | 'Pending' | 'Paid' | 'Overdue' | 'Cancelled'

export type Invoice = {
    id: string
    workspaceId: string
    clientId: string
    items: InvoiceItem[]
    status: InvoiceStatus
    issueDate: string
    dueDate: string
    notes?: string
    subtotal: number
    tax: number
    total: number
}
