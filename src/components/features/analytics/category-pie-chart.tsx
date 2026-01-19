"use client"

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts"
import { useMockDatabase } from '@/lib/contexts/mock-db-context'
import { useMemo } from "react"

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6']

export function CategoryPieChart() {
    // In a real app, query "Orders" or "Transactions" to build this.
    // We'll mock it for now but structure it to receive props later
    const data = [
        { name: 'Coffee', value: 400 },
        { name: 'Food', value: 300 },
        { name: 'Merch', value: 100 },
        { name: 'Catering', value: 200 },
    ]

    return (
        <ResponsiveContainer width="100%" height={300}>
            <PieChart>
                <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                >
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                </Pie>
                <Tooltip
                    contentStyle={{ backgroundColor: '#000', borderRadius: '8px', border: '1px solid #333' }}
                    itemStyle={{ color: '#fff' }}
                />
                <Legend verticalAlign="bottom" height={36} />
            </PieChart>
        </ResponsiveContainer>
    )
}
