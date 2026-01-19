"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Lock, Sparkles, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"

export function MarketPulse() {
    return (
        <div className="relative group">
            {/* Background: The Mocked "Live" Content */}
            <Card className="bg-black/40 border-white/10 overflow-hidden relative opacity-50 blur-[2px] group-hover:blur-[4px] transition-all duration-500">
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-purple-400" />
                        AI Market Pulse
                    </CardTitle>
                    <Badge variant="outline" className="text-purple-400 border-purple-400/30">LIVE</Badge>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Mock Article 1 */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-widest">
                            <span>Crypto • 2m ago</span>
                            <div className="h-1 w-1 rounded-full bg-gray-500" />
                            <span>Bloomberg</span>
                        </div>
                        <h3 className="text-lg font-semibold text-white leading-tight">
                            Bitcoin reclaims $68k as institutional inflows surge for 5th consecutive week.
                        </h3>
                        <p className="text-sm text-gray-400">
                            BlackRock's IBIT ETF breaks volume records, signaling renewed Wall Street confidence...
                        </p>
                    </div>

                    {/* Mock Article 2 */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-widest">
                            <span>Equities • 15m ago</span>
                            <div className="h-1 w-1 rounded-full bg-gray-500" />
                            <span>Reuters</span>
                        </div>
                        <h3 className="text-lg font-semibold text-white leading-tight">
                            Fed signals aggressive rate cuts may be delayed until Q4.
                        </h3>
                        <p className="text-sm text-gray-400">
                            Jerome Powell cites "sticky inflation" in services sector as primary driver for caution...
                        </p>
                    </div>

                    {/* Mock Article 3 */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-widest">
                            <span>Tech • 1h ago</span>
                            <div className="h-1 w-1 rounded-full bg-gray-500" />
                            <span>TechCrunch</span>
                        </div>
                        <h3 className="text-lg font-semibold text-white leading-tight">
                            Apple announces partnership with Google for Gemini usage in iOS 19.
                        </h3>
                    </div>
                </CardContent>
            </Card>

            {/* Foreground: The Lock Overlay */}
            <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="bg-black/80 backdrop-blur-md border border-white/10 p-8 rounded-2xl text-center space-y-4 max-w-sm mx-4 shadow-2xl">
                    <div className="h-12 w-12 rounded-full bg-purple-500/10 flex items-center justify-center mx-auto mb-2">
                        <Lock className="h-6 w-6 text-purple-400" />
                    </div>
                    <h3 className="text-xl font-bold text-white">Unlock Market Intelligence</h3>
                    <p className="text-sm text-gray-400">
                        Get real-time, AI-summarized briefings on your specific asset portfolio. Powered by Perplexity Pro.
                    </p>
                    <Button className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-semibold">
                        <Zap className="h-4 w-4 mr-2 fill-current" /> Upgrade to Pro
                    </Button>
                    <p className="text-[10px] text-gray-600 uppercase tracking-widest">Coming Soon</p>
                </div>
            </div>
        </div>
    )
}
