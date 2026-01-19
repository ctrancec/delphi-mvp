"use client"

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useMockDatabase } from '@/lib/contexts/mock-db-context'

import { useWorkspace } from '@/lib/contexts/workspace-context'
import { useMemo } from 'react'

export function RevenueChart() {
    const { activeWorkspace } = useWorkspace()
    const { transactions: allTransactions } = useMockDatabase()

    const transactions = useMemo(() =>
        allTransactions.filter(t => t.workspaceId === activeWorkspace.id),
        [allTransactions, activeWorkspace.id])

    // Aggregate transactions by date (simplified for demo to show last 7 days or similar)
    // For a robust demo, we might want to mock "Last 6 Months"
    // Let's simulate Monthly Data based on the Mock Data we have + some random history
    const data = [
        { name: "Jan", total: Math.floor(Math.random() * 5000) + 1000 },
        { name: "Feb", total: Math.floor(Math.random() * 5000) + 1000 },
        { name: "Mar", total: Math.floor(Math.random() * 5000) + 1000 },
        { name: "Apr", total: Math.floor(Math.random() * 5000) + 1000 },
        { name: "May", total: Math.floor(Math.random() * 5000) + 1000 },
        { name: "Jun", total: Math.floor(Math.random() * 5000) + 1000 },
    ]

    // Add current month revenue from mock DB
    const currentMonthRevenue = transactions.reduce((acc, t) => acc + t.amount, 0)
    // Update the last month in our static list to reflect "real" data if we wanted, 
    // or just append "Current"
    data.push({ name: "Current", total: currentMonthRevenue + 2000 }) // +2000 base to make it look decent

    return (
        <ResponsiveContainer width="100%" height={350}>
            <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                <XAxis
                    dataKey="name"
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                />
                <YAxis
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `$${value}`}
                />
                <Tooltip
                    contentStyle={{ backgroundColor: '#000', borderRadius: '8px', border: '1px solid #333' }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(value: any) => [`$${(value || 0).toFixed(2)}`, 'Revenue']}
                />
                <Bar
                    dataKey="total"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                />
            </BarChart>
        </ResponsiveContainer>
    )
}
