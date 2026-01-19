import { Transaction } from "@/lib/contexts/mock-db-context"
import { TaxCode } from "@/lib/types/finance"

// CRA Line Codes for T2125
export const CRA_CATEGORIES: Record<string, { code: string, label: string, rate: number }> = {
    'Advertising': { code: '8521', label: 'Advertising', rate: 1.0 },
    'Meals': { code: '8523', label: 'Meals and entertainment', rate: 0.5 }, // 50% deductible
    'Bad Debts': { code: '8590', label: 'Bad debts', rate: 1.0 },
    'Insurance': { code: '8690', label: 'Insurance', rate: 1.0 },
    'Interest': { code: '8710', label: 'Interest and bank charges', rate: 1.0 },
    'Business Tax': { code: '8760', label: 'Business taxes, licenses and memberships', rate: 1.0 },
    'Office Expenses': { code: '8810', label: 'Office expenses', rate: 1.0 },
    'Supplies': { code: '8811', label: 'Office stationery and supplies', rate: 1.0 },
    'Legal': { code: '8860', label: 'Professional fees', rate: 1.0 },
    'Rent': { code: '8910', label: 'Rent', rate: 1.0 },
    'Repairs': { code: '8960', label: 'Repairs and maintenance', rate: 1.0 },
    'Salaries': { code: '9060', label: 'Salaries, wages and benefits', rate: 1.0 },
    'Travel': { code: '9200', label: 'Travel', rate: 1.0 },
    'Utilities': { code: '9220', label: 'Utilities', rate: 1.0 },
    'Fuel': { code: '9281', label: 'Motor vehicle expenses', rate: 1.0 },
    'Delivery': { code: '9275', label: 'Delivery, freight and express', rate: 1.0 },
    'Other': { code: '9270', label: 'Other expenses', rate: 1.0 },
}

// Provincial Tax Rates (GST/HST/PST)
export interface TaxRate {
    label: string
    gst: number // Federal
    pst: number // Provincial (PST, RST, QST)
    hst: number // Harmonized
    type: 'GST' | 'HST' | 'GST+PST' | 'GST+QST'
}

export const PROVINCIAL_RATES: Record<string, TaxRate> = {
    'AB': { label: 'Alberta', gst: 0.05, pst: 0.00, hst: 0.00, type: 'GST' },
    'BC': { label: 'British Columbia', gst: 0.05, pst: 0.07, hst: 0.00, type: 'GST+PST' },
    'MB': { label: 'Manitoba', gst: 0.05, pst: 0.07, hst: 0.00, type: 'GST+PST' }, // RST is treated as PST here
    'NB': { label: 'New Brunswick', gst: 0.00, pst: 0.00, hst: 0.15, type: 'HST' },
    'NL': { label: 'Newfoundland and Labrador', gst: 0.00, pst: 0.00, hst: 0.15, type: 'HST' },
    'NS': { label: 'Nova Scotia', gst: 0.00, pst: 0.00, hst: 0.15, type: 'HST' },
    'NT': { label: 'Northwest Territories', gst: 0.05, pst: 0.00, hst: 0.00, type: 'GST' },
    'NU': { label: 'Nunavut', gst: 0.05, pst: 0.00, hst: 0.00, type: 'GST' },
    'ON': { label: 'Ontario', gst: 0.00, pst: 0.00, hst: 0.13, type: 'HST' },
    'PE': { label: 'Prince Edward Island', gst: 0.00, pst: 0.00, hst: 0.15, type: 'HST' },
    'QC': { label: 'Quebec', gst: 0.05, pst: 0.09975, hst: 0.00, type: 'GST+QST' },
    'SK': { label: 'Saskatchewan', gst: 0.05, pst: 0.06, hst: 0.00, type: 'GST+PST' },
    'YT': { label: 'Yukon', gst: 0.05, pst: 0.00, hst: 0.00, type: 'GST' },
}

export function calculateTax(amount: number, taxCode: TaxCode = 'standard', provinceCode: string) {
    const rates = PROVINCIAL_RATES[provinceCode] || PROVINCIAL_RATES['ON'] // Default to ON
    let gst = 0
    let pst = 0
    let hst = 0

    if (taxCode === 'exempt' || taxCode === 'zero_rated') {
        return { gst: 0, pst: 0, hst: 0, total: 0 }
    }

    if (taxCode === 'gst_only') {
        // Force GST (5%), ignore PST/HST
        // Even in HST provinces, "GST Only" implies the federal portion only
        gst = amount * 0.05
    } else {
        // Standard Rate
        if (rates.type === 'HST') {
            hst = amount * rates.hst
        } else {
            gst = amount * rates.gst
            pst = amount * rates.pst
        }
    }

    return {
        gst,
        pst,
        hst,
        total: gst + pst + hst
    }
}

export function extractTax(inclusiveAmount: number, taxCode: TaxCode = 'standard', provinceCode: string) {
    const rates = PROVINCIAL_RATES[provinceCode] || PROVINCIAL_RATES['ON']
    let rate = 0
    let gstRate = 0
    let pstRate = 0
    let hstRate = 0

    if (taxCode === 'exempt' || taxCode === 'zero_rated') {
        return { gst: 0, pst: 0, hst: 0, total: 0, net: inclusiveAmount }
    }

    if (taxCode === 'gst_only') {
        rate = 0.05
        gstRate = 0.05
    } else {
        if (rates.type === 'HST') {
            rate = rates.hst
            hstRate = rates.hst
        } else {
            rate = rates.gst + rates.pst
            gstRate = rates.gst
            pstRate = rates.pst
        }
    }

    const net = inclusiveAmount / (1 + rate)
    const totalTax = inclusiveAmount - net

    return {
        gst: net * gstRate,
        pst: net * pstRate,
        hst: net * hstRate,
        total: totalTax,
        net
    }
}

export function generateT2125CSV(transactions: Transaction[], year: number = new Date().getFullYear()): string {
    const headers = ['Date', 'Description', 'Category', 'CRA Line', 'Total Amount', 'GST/HST Paid', 'Net Expense', 'Deductible Amount']

    // Filter for chosen year and expenses
    const expenses = transactions.filter(t =>
        t.type === 'expense' &&
        new Date(t.date).getFullYear() === year
    )

    const rows = expenses.map(t => {
        const categoryInfo = CRA_CATEGORIES[t.category] || CRA_CATEGORIES['Other']

        // Assume 5% GST is embedded in the expense for simplicity of this "Smart" feature
        // In reality, you'd track tax specifically.
        const totalAmount = Math.abs(t.amount)
        const gstPaid = totalAmount * (0.05 / 1.05) // Extract embedded GST (simplification)
        const netExpense = totalAmount - gstPaid
        const deductible = netExpense * categoryInfo.rate

        return [
            new Date(t.date).toLocaleDateString(),
            `"${t.description.replace(/"/g, '""')}"`, // Escape quotes
            categoryInfo.label,
            categoryInfo.code,
            totalAmount.toFixed(2),
            gstPaid.toFixed(2),
            netExpense.toFixed(2),
            deductible.toFixed(2)
        ].join(',')
    })

    return [headers.join(','), ...rows].join('\n')
}

export function downloadCSV(content: string, filename: string) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
}
