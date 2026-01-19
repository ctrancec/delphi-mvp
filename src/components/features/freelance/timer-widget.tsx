"use client"

import { useTimer } from "@/lib/contexts/timer-context"
import { useWorkspace } from "@/lib/contexts/workspace-context"
import { Button } from "@/components/ui/button"
import { Pause, Play, Square, Timer } from "lucide-react"
import { JOBS_DATA } from "@/lib/mock-data"
import { cn } from "@/lib/utils"

export function TimerWidget() {
    const { timerState, elapsedTime, pauseTimer, resumeTimer, stopTimer } = useTimer()
    const { activeWorkspace } = useWorkspace()

    // Only show if timer is active (running or paused) AND current workspace is freelance
    // (Or maybe show globally if timer is running? Let's restrict to Freelance for now to keep context clean)
    if (timerState.status === 'idle') return null
    if (activeWorkspace.type !== 'freelance') return null

    const job = JOBS_DATA.find(j => j.id === timerState.jobId)
    if (!job) return null

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600)
        const m = Math.floor((seconds % 3600) / 60)
        const s = seconds % 60
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }

    return (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
            <div className={cn(
                "flex items-center gap-4 p-4 rounded-xl border backdrop-blur-xl shadow-2xl transition-colors",
                timerState.status === 'running'
                    ? "bg-black/80 border-emerald-500/50 shadow-emerald-500/10"
                    : "bg-black/80 border-yellow-500/50"
            )}>
                <div className={cn(
                    "flex items-center justify-center w-10 h-10 rounded-full",
                    timerState.status === 'running' ? "bg-emerald-500/20 text-emerald-400 animate-pulse" : "bg-yellow-500/20 text-yellow-400"
                )}>
                    <Timer className="w-5 h-5" />
                </div>

                <div className="flex flex-col min-w-[140px]">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                        {timerState.status === 'running' ? 'Tracking Time' : 'Timer Paused'}
                    </span>
                    <span className="text-sm font-bold text-white truncate max-w-[200px]">
                        {job.title}
                    </span>
                </div>

                <div className="flex flex-col items-end min-w-[80px] border-l border-white/10 pl-4">
                    <span className="text-2xl font-mono font-bold tracking-tight text-white">
                        {formatTime(elapsedTime)}
                    </span>
                    <span className="text-xs text-emerald-400">
                        ${((elapsedTime / 3600) * job.rate).toFixed(2)} earned
                    </span>
                </div>

                <div className="flex items-center gap-1 pl-2">
                    {timerState.status === 'running' ? (
                        <Button variant="ghost" size="icon" className="hover:bg-white/10 hover:text-yellow-400" onClick={pauseTimer}>
                            <Pause className="w-5 h-5" />
                        </Button>
                    ) : (
                        <Button variant="ghost" size="icon" className="hover:bg-white/10 hover:text-emerald-400" onClick={resumeTimer}>
                            <Play className="w-5 h-5" />
                        </Button>
                    )}
                    <Button variant="ghost" size="icon" className="hover:bg-red-500/20 hover:text-red-400" onClick={stopTimer}>
                        <Square className="w-4 h-4 fill-current" />
                    </Button>
                </div>
            </div>
        </div>
    )
}
