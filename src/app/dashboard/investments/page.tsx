"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts"
import { ArrowUpRight, ArrowDownRight, TrendingUp, Wallet, DollarSign, Bitcoin, RefreshCw, Layers } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { MarketPulse } from "@/components/market-pulse"

// --- Mock Holdings (Quantity) ---
const HOLDINGS = {
    bitcoin: 1.45,  // BTC
    ethereum: 12.5, // ETH
    solana: 150,    // SOL
    cash: 42500,    // USD
    sp500: 125000   // USD (Voo equivalent)
}

type MarketData = {
    bitcoin: { usd: number, usd_24h_change: number }
    ethereum: { usd: number, usd_24h_change: number }
    solana: { usd: number, usd_24h_change: number }
}

const COLORS = ['#F7931A', '#627EEA', '#14F195', '#10B981', '#3B82F6'] // BTC, ETH, SOL, CASH, STOCKS

export default function InvestmentsPage() {
    const [prices, setPrices] = useState<MarketData | null>(null)
    const [loading, setLoading] = useState(true)

    // Fetch Live Prices
    const fetchPrices = async () => {
        setLoading(true)
        try {
            // CoinGecko Free API
            const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true')
            const data = await res.json()
            setPrices(data)
        } catch (error) {
            console.error("Failed to fetch crypto prices", error)
            // Fallback for demo if API limits hit
            setPrices({
                bitcoin: { usd: 64230, usd_24h_change: 2.5 },
                ethereum: { usd: 3450, usd_24h_change: -1.2 },
                solana: { usd: 145, usd_24h_change: 5.4 }
            })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchPrices()
    }, [])

    // Calculate Portfolio Value
    const btcValue = (prices?.bitcoin.usd || 0) * HOLDINGS.bitcoin
    const ethValue = (prices?.ethereum.usd || 0) * HOLDINGS.ethereum
    const solValue = (prices?.solana.usd || 0) * HOLDINGS.solana

    const totalCrypto = btcValue + ethValue + solValue
    const totalValue = totalCrypto + HOLDINGS.cash + HOLDINGS.sp500

    const allocationData = [
        { name: 'Bitcoin', value: btcValue },
        { name: 'Ethereum', value: ethValue },
        { name: 'Solana', value: solValue },
        { name: 'Cash', value: HOLDINGS.cash },
        { name: 'Stocks (S&P 500)', value: HOLDINGS.sp500 },
    ]

    // Format Currency
    const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
    const fmtPct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`

    if (loading && !prices) {
        return <div className="p-8 space-y-6">
            <Skeleton className="h-12 w-48 bg-white/10" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full bg-white/10 rounded-xl" />)}
            </div>
            <Skeleton className="h-[400px] w-full bg-white/10 rounded-xl" />
        </div>
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
                        <Wallet className="h-8 w-8 text-cyan-400" />
                        Investment Portfolio
                    </h1>
                    <p className="text-gray-400 mt-1">Live tracking of your personal wealth across classes.</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-right hidden md:block">
                        <p className="text-sm text-gray-500">Total Net Worth</p>
                        <p className="text-2xl font-mono text-emerald-400">{fmt(totalValue)}</p>
                    </div>
                    <button
                        onClick={fetchPrices}
                        aria-label="Refresh Prices"
                        className="p-3 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10 active:scale-95 touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                        <RefreshCw className={`h-5 w-5 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Asset Class Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* 1. Crypto Card */}
                <Card className="bg-white/5 border-white/10 backdrop-blur-md relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-gray-400 flex justify-between">
                            Crypto Holdings <Bitcoin className="h-4 w-4 text-orange-500" />
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white mb-1">{fmt(totalCrypto)}</div>
                        <div className="flex items-center gap-2 text-xs">
                            <div className="flex -space-x-2">
                                <div className="h-6 w-6 rounded-full bg-orange-500 flex items-center justify-center text-[8px] font-bold">B</div>
                                <div className="h-6 w-6 rounded-full bg-blue-500 flex items-center justify-center text-[8px] font-bold text-white">E</div>
                                <div className="h-6 w-6 rounded-full bg-green-500 flex items-center justify-center text-[8px] font-bold text-black">S</div>
                            </div>
                            <span className="text-gray-500">3 Assets</span>
                        </div>
                    </CardContent>
                </Card>

                {/* 2. Stocks Card */}
                <Card className="bg-white/5 border-white/10 backdrop-blur-md relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-gray-400 flex justify-between">
                            Stock Market <TrendingUp className="h-4 w-4 text-blue-500" />
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white mb-1">{fmt(HOLDINGS.sp500)}</div>
                        <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 hover:bg-blue-500/20">Vanguard S&P 500</Badge>
                    </CardContent>
                </Card>

                {/* 3. Cash Card */}
                <Card className="bg-white/5 border-white/10 backdrop-blur-md relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-gray-400 flex justify-between">
                            Cash & Equivalents <DollarSign className="h-4 w-4 text-emerald-500" />
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white mb-1">{fmt(HOLDINGS.cash)}</div>
                        <span className="text-xs text-gray-500">Across 2 Accounts</span>
                    </CardContent>
                </Card>
            </div>

            {/* Main Visuals Area */}
            <div className="grid lg:grid-cols-2 gap-8">

                {/* Chart Section */}
                <Card className="bg-black/40 border-white/10 h-[400px]">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Layers className="h-5 w-5 text-gray-400" /> Allocation
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={allocationData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={100}
                                    paddingAngle={5}
                                    dataKey="value"
                                    stroke="none"
                                >
                                    {allocationData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: '8px' }}
                                    itemStyle={{ color: '#e4e4e7' }}
                                    formatter={(value: number | undefined) => [value ? fmt(value) : '...', 'Value']}
                                />
                                <Legend verticalAlign="bottom" height={36} iconType="circle" />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Live Ticker Table */}
                <Card className="bg-black/40 border-white/10 h-[400px] overflow-auto">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            Live Pricing <span className="text-xs font-normal text-gray-500 ml-2">(Source: CoinGecko)</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Bitcoin Row */}
                        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                            <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-[#F7931A] flex items-center justify-center text-white font-bold text-xs">₿</div>
                                <div>
                                    <div className="font-semibold text-white">Bitcoin</div>
                                    <div className="text-xs text-gray-500">{HOLDINGS.bitcoin} BTC</div>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="font-mono text-white">{fmt(prices?.bitcoin.usd || 0)}</div>
                                <div className={`text-xs flex items-center justify-end ${(prices?.bitcoin.usd_24h_change || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {(prices?.bitcoin.usd_24h_change || 0) >= 0 ? <ArrowUpRight className="h-3 w-3 mr-1" /> : <ArrowDownRight className="h-3 w-3 mr-1" />}
                                    {fmtPct(prices?.bitcoin.usd_24h_change || 0)}
                                </div>
                            </div>
                        </div>

                        {/* Ethereum Row */}
                        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                            <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-[#627EEA] flex items-center justify-center text-white font-bold text-xs">Ξ</div>
                                <div>
                                    <div className="font-semibold text-white">Ethereum</div>
                                    <div className="text-xs text-gray-500">{HOLDINGS.ethereum} ETH</div>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="font-mono text-white">{fmt(prices?.ethereum.usd || 0)}</div>
                                <div className={`text-xs flex items-center justify-end ${(prices?.ethereum.usd_24h_change || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {(prices?.ethereum.usd_24h_change || 0) >= 0 ? <ArrowUpRight className="h-3 w-3 mr-1" /> : <ArrowDownRight className="h-3 w-3 mr-1" />}
                                    {fmtPct(prices?.ethereum.usd_24h_change || 0)}
                                </div>
                            </div>
                        </div>

                        {/* Solana Row */}
                        <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                            <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-[#14F195] flex items-center justify-center text-black font-bold text-xs">S</div>
                                <div>
                                    <div className="font-semibold text-white">Solana</div>
                                    <div className="text-xs text-gray-500">{HOLDINGS.solana} SOL</div>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="font-mono text-white">{fmt(prices?.solana.usd || 0)}</div>
                                <div className={`text-xs flex items-center justify-end ${(prices?.solana.usd_24h_change || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {(prices?.solana.usd_24h_change || 0) >= 0 ? <ArrowUpRight className="h-3 w-3 mr-1" /> : <ArrowDownRight className="h-3 w-3 mr-1" />}
                                    {fmtPct(prices?.solana.usd_24h_change || 0)}
                                </div>
                            </div>
                        </div>

                    </CardContent>
                </Card>
            </div>
            {/* Market Pulse (Locked) */}
            <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200">
                <MarketPulse />
            </div>
        </div>
    )
}
