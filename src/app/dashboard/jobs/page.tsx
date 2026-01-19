"use client"

import { useState } from "react"
import { useWorkspace } from "@/lib/contexts/workspace-context"
import { useTimer } from "@/lib/contexts/timer-context"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import Link from 'next/link'
import { JOBS_DATA } from "@/lib/mock-data"
import { Badge } from "@/components/ui/badge"
import { Play, Pause, Square, Plus, Search, FileText, Clock } from "lucide-react"

export default function JobsPage() {
    const { activeWorkspace } = useWorkspace()
    const { timerState, startTimer, pauseTimer, resumeTimer, elapsedTime } = useTimer()
    const [jobs, setJobs] = useState(JOBS_DATA)
    const [searchQuery, setSearchQuery] = useState("")

    if (activeWorkspace.type !== 'freelance') {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
                <div className="p-4 rounded-full bg-muted/10">
                    <Clock className="w-12 h-12 text-muted-foreground" />
                </div>
                <h2 className="text-xl font-semibold">Freelance Feature</h2>
                <p className="text-muted-foreground max-w-md">
                    Switch to a Freelance workspace to manage Jobs and Time Tracking.
                </p>
            </div>
        )
    }

    const filteredJobs = jobs.filter(job =>
        job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        job.client.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white">Jobs & Invoicing</h1>
                    <p className="text-muted-foreground">Manage ongoing projects, track time, and bill clients.</p>
                </div>
                <div className="flex gap-2">
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        New Job
                    </Button>
                </div>
            </div>

            <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Search jobs..."
                        className="pl-9 bg-white/5 border-white/10"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {filteredJobs.map((job) => {
                    const isRunning = timerState.status === 'running' && timerState.jobId === job.id
                    const isPaused = timerState.status === 'paused' && timerState.jobId === job.id

                    return (
                        <Card key={job.id} className={`bg-black/40 border-white/10 backdrop-blur-xl hover:bg-white/5 transition-colors group ${isRunning ? 'border-primary/50 bg-primary/5' : ''}`}>
                            <CardHeader className="pb-3">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="text-xs font-semibold text-emerald-400 mb-1">{job.client}</div>
                                        <CardTitle className="text-lg font-bold text-white">{job.title}</CardTitle>
                                    </div>
                                    <Badge variant={job.status === 'Active' ? 'default' : 'secondary'} className={job.status === 'Active' ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' : ''}>
                                        {job.status}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Total Hours</div>
                                            <div className="font-mono font-medium text-white">{job.totalHours.toFixed(1)}h</div>
                                        </div>
                                        <div>
                                            <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Unbilled</div>
                                            <div className="font-mono font-medium text-emerald-400">{job.unbilledHours.toFixed(1)}h</div>
                                        </div>
                                        <div>
                                            <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Value</div>
                                            <div className="font-mono font-medium text-white">${(job.unbilledHours * job.rate).toLocaleString()}</div>
                                        </div>
                                        <div>
                                            <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Due Date</div>
                                            <div className="font-medium text-white">{job.dueDate}</div>
                                        </div>
                                    </div>

                                    <div className="pt-2 flex gap-2">
                                        {isRunning ? (
                                            <Button variant="default" size="sm" className="flex-1 bg-red-500 hover:bg-red-600 animate-pulse" onClick={pauseTimer}>
                                                <Pause className="mr-2 h-3.5 w-3.5" />
                                                Pause ({elapsedTime}s)
                                            </Button>
                                        ) : isPaused ? (
                                            <Button variant="secondary" size="sm" className="flex-1" onClick={resumeTimer}>
                                                <Play className="mr-2 h-3.5 w-3.5" />
                                                Resume
                                            </Button>
                                        ) : (
                                            <Button variant="outline" size="sm" className="flex-1 border-white/10 hover:bg-white/10" onClick={() => startTimer(job.id)}>
                                                <Play className="mr-2 h-3.5 w-3.5" />
                                                Track Time
                                            </Button>
                                        )}

                                        <Button variant="outline" size="sm" className="flex-1 border-white/10 hover:bg-white/10" disabled={job.unbilledHours === 0} asChild>
                                            <Link href={`/dashboard/invoices/new?jobId=${job.id}`}>
                                                <FileText className="mr-2 h-3.5 w-3.5" />
                                                Invoice
                                            </Link>
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )
                })}
            </div>
        </div>
    )
}
