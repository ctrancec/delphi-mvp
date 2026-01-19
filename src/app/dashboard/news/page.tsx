"use client"

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, BookOpen, Clock, Bot, AlertTriangle, Settings, TrendingUp, Share2, ChevronLeft, ArrowRight, Sparkles, Loader2, RefreshCw } from 'lucide-react'
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

export default function NewsPage() {
    const [stories, setStories] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [activeStory, setActiveStory] = useState<string | null>(null)
    const [userTopics, setUserTopics] = useState(["Coffee", "Technology", "Local Regulation", "Competitors"])
    const [topicsInput, setTopicsInput] = useState("Coffee, Technology, Local Regulation, Competitors")
    const [isDialogOpen, setIsDialogOpen] = useState(false)

    const fetchStories = async (topics: string[]) => {
        setIsLoading(true)
        try {
            const res = await fetch('/api/intelligence', {
                method: 'POST',
                body: JSON.stringify({ topics }),
                headers: { 'Content-Type': 'application/json' }
            })
            if (!res.ok) throw new Error("Failed to fetch")
            const data = await res.json()
            if (data.stories) {
                // Ensure IDs are unique to prevent key errors
                const formattedStories = data.stories.map((s: any, i: number) => ({
                    ...s,
                    id: s.id || `gen-${i}`,
                    type: i === 0 ? 'hero' : 'trending' // Enforce first item as hero
                }))
                setStories(formattedStories)
            }
        } catch (err) {
            console.error(err)
            // Fallback to error UI (or keep old stories)
        } finally {
            setIsLoading(false)
        }
    }

    // Initial Fetch
    useEffect(() => {
        fetchStories(userTopics)
    }, [])

    const handleSaveTopics = () => {
        const newTopics = topicsInput.split(',').map(t => t.trim()).filter(Boolean)
        setUserTopics(newTopics)
        setIsDialogOpen(false)
        fetchStories(newTopics) // Refresh feed with new topics
    }

    // Find the active article object
    const selectedArticle = stories.find(s => s.id === activeStory)

    return (
        <div className="max-w-6xl mx-auto space-y-8 pb-20 px-4 md:px-0">

            {/* Header / Nav */}
            <div className="flex items-center justify-between py-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Sparkles className="h-6 w-6 text-cyan-400" />
                        Discover
                    </h1>
                    <p className="text-muted-foreground">Curated intelligence for your business.</p>
                </div>

                <div className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => fetchStories(userTopics)} disabled={isLoading} className="min-h-[44px] min-w-[44px]">
                        <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                    </Button>

                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" className="border-white/10 gap-2">
                                <Settings className="h-4 w-4" />
                                Feed Preferences
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-zinc-950 border-white/10 text-white">
                            <DialogHeader>
                                <DialogTitle>Curate Your Feed</DialogTitle>
                                <DialogDescription>
                                    Delphi scans thousands of sources. Tell us what matters to you.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-6 py-4">
                                <div className="space-y-3">
                                    <Label>Active Topics</Label>
                                    <div className="flex flex-wrap gap-2">
                                        {userTopics.map(topic => (
                                            <Badge key={topic} variant="secondary" className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                                                {topic}
                                            </Badge>
                                        ))}
                                    </div>
                                    <div className="pt-2">
                                        <Label>Edit Keywords (Comma Separated)</Label>
                                        <Input
                                            value={topicsInput}
                                            onChange={(e) => setTopicsInput(e.target.value)}
                                            className="bg-zinc-900 border-white/10 mt-1"
                                        />
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleSaveTopics}>Save & Refresh Feed</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {isLoading ? (
                // --- Loading Skeletons ---
                <div className="space-y-8 animate-pulse">
                    <div className="h-[400px] w-full bg-white/5 rounded-2xl border border-white/10" />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-[200px] bg-white/5 rounded-xl border border-white/10" />
                        ))}
                    </div>
                </div>
            ) : selectedArticle ? (
                // --- Detailed Read View (Perplexity Page Style) ---
                <div className="animate-in fade-in slide-in-from-right-8 duration-300">
                    <Button
                        variant="ghost"
                        className="mb-4 pl-0 text-muted-foreground hover:text-white gap-2 min-h-[44px]"
                        onClick={() => setActiveStory(null)}
                    >
                        <ChevronLeft className="h-4 w-4" /> Back to Discover
                    </Button>

                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
                        {/* Main Article Content */}
                        <div className="space-y-8">
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-sm text-cyan-400 font-medium uppercase tracking-wider">
                                    <TrendingUp className="h-4 w-4" />
                                    {selectedArticle.category}
                                </div>
                                <h1 className="text-4xl font-bold leading-tight text-white mb-4">
                                    {selectedArticle.title}
                                </h1>
                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                    <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {selectedArticle.readTime}</span>
                                    <span>•</span>
                                    <span>{selectedArticle.date}</span>
                                </div>
                            </div>

                            {/* AI Summary Block */}
                            <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
                                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                                    <Bot className="h-4 w-4 text-cyan-400" />
                                    Delphi Synthesis
                                </div>
                                <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-headings:text-white prose-strong:text-cyan-400">
                                    <div className="whitespace-pre-wrap">
                                        {selectedArticle.content}
                                    </div>
                                </div>
                            </div>

                            {/* Disclaimer */}
                            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4 flex gap-3">
                                <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0" />
                                <p className="text-xs text-yellow-500/90 leading-relaxed">
                                    This report is generated by AI based on public news sources. Market conditions change rapidly; verify critical financial data independently.
                                </p>
                            </div>
                        </div>

                        {/* Sidebar: Sources & Related */}
                        <div className="space-y-6">
                            <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
                                <h3 className="font-semibold text-white flex items-center gap-2">
                                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                                    Sources
                                </h3>
                                <div className="space-y-2">
                                    {selectedArticle.sources.map((s: any, i: number) => (
                                        <a href={s.url} key={i} className="flex items-center justify-between p-2 rounded hover:bg-white/5 transition-colors group">
                                            <span className="text-sm text-muted-foreground group-hover:text-white">{s.name}</span>
                                            <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary" />
                                        </a>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
                                <h3 className="font-semibold text-white flex items-center gap-2">
                                    <Share2 className="h-4 w-4 text-muted-foreground" />
                                    Share
                                </h3>
                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm" className="flex-1 border-white/10">Copy Link</Button>
                                    <Button variant="outline" size="sm" className="flex-1 border-white/10">Email</Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                // --- Discover Grid View ---
                <div className="space-y-8 animate-in fade-in duration-500">

                    {/* Hero Section */}
                    {stories.filter(s => s.type === "hero").map(story => (
                        <div
                            key={story.id}
                            className="relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 group cursor-pointer"
                            onClick={() => setActiveStory(story.id)}
                        >
                            <div className={`absolute inset-0 opacity-20 bg-gradient-to-br ${story.image}`} />
                            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/50 to-transparent" />

                            <div className="relative p-8 md:p-12 flex flex-col justify-end min-h-[400px]">
                                <Badge className="w-fit mb-4 bg-red-500/20 text-red-400 border-red-500/50 hover:bg-red-500/30">
                                    {story.category}
                                </Badge>
                                <h2 className="text-3xl md:text-5xl font-bold text-white mb-4 leading-tight max-w-3xl group-hover:text-cyan-400 transition-colors">
                                    {story.title}
                                </h2>
                                <p className="text-lg text-gray-300 max-w-2xl mb-6 line-clamp-2">
                                    {story.summary}
                                </p>
                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                    <span className="flex items-center gap-1"><Bot className="h-4 w-4 text-cyan-400" /> AI Quant Report</span>
                                    <span>•</span>
                                    <span>{story.readTime}</span>
                                    <span>•</span>
                                    <span className="flex items-center gap-1 group-hover:text-white transition-colors">Read Full Brief <ArrowRight className="h-4 w-4" /></span>
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Trending Grid */}
                    <div>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-semibold text-white flex items-center gap-2">
                                <TrendingUp className="h-5 w-5 text-muted-foreground" />
                                Trending in Your Sector
                            </h3>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {stories.filter(s => s.type !== "hero").map(story => (
                                <Card
                                    key={story.id}
                                    className="bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer group flex flex-col h-full"
                                    onClick={() => setActiveStory(story.id)}
                                >
                                    <div className={`h-2 bg-gradient-to-r ${story.image} w-full opacity-50`} />
                                    <CardHeader>
                                        <div className="flex items-center justify-between mb-2">
                                            <Badge variant="secondary" className="text-[10px]">
                                                {story.category}
                                            </Badge>
                                            <span className="text-[10px] text-muted-foreground">{story.date}</span>
                                        </div>
                                        <CardTitle className="text-lg leading-snug group-hover:text-cyan-400 transition-colors">
                                            {story.title}
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="flex-1">
                                        <p className="text-sm text-muted-foreground line-clamp-3">
                                            {story.summary}
                                        </p>
                                    </CardContent>
                                    <CardFooter className="pt-0 border-t border-white/5 mt-auto">
                                        <div className="w-full flex items-center justify-between pt-4 text-xs text-muted-foreground">
                                            <div className="flex items-center gap-2">
                                                <div className="flex -space-x-2">
                                                    {[1, 2].map(i => (
                                                        <div key={i} className="h-5 w-5 rounded-full bg-white/10 border border-zinc-900" />
                                                    ))}
                                                </div>
                                                <span>{story.sources.length} sources</span>
                                            </div>
                                            <span className="group-hover:translate-x-1 transition-transform">
                                                <ArrowRight className="h-4 w-4" />
                                            </span>
                                        </div>
                                    </CardFooter>
                                </Card>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
