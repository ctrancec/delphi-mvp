"use client"

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'

type TimerStatus = 'idle' | 'running' | 'paused'

interface TimerState {
    status: TimerStatus
    jobId: number | null
    startTime: number | null // Timestamp when timer started
    accumulatedTime: number // Previous elapsed time in seconds
}

interface TimerContextType {
    timerState: TimerState
    elapsedTime: number // Calculated live
    startTimer: (jobId: number) => void
    pauseTimer: () => void
    stopTimer: () => void // Resets and saves (mock save)
    resumeTimer: () => void
}

const TimerContext = createContext<TimerContextType | undefined>(undefined)

export function TimerProvider({ children }: { children: ReactNode }) {
    const [timerState, setTimerState] = useState<TimerState>({
        status: 'idle',
        jobId: null,
        startTime: null,
        accumulatedTime: 0
    })

    // Live elapsed time counter for UI
    const [elapsedTime, setElapsedTime] = useState(0)

    // Update elapsed time every second if running
    useEffect(() => {
        let interval: NodeJS.Timeout

        if (timerState.status === 'running' && timerState.startTime) {
            interval = setInterval(() => {
                const now = Date.now()
                // Total elapsed = accumulated + (current - start) / 1000
                if (timerState.startTime) {
                    const currentSessionSeconds = Math.floor((now - timerState.startTime) / 1000)
                    setElapsedTime(timerState.accumulatedTime + currentSessionSeconds)
                }
            }, 1000)
        }
        return () => clearInterval(interval)
    }, [timerState])

    const startTimer = (jobId: number) => {
        // If already running for same job, ignore? Or restart? 
        // For now, simple logic: overwrite
        setTimerState({
            status: 'running',
            jobId,
            startTime: Date.now(),
            accumulatedTime: 0
        })
    }

    const pauseTimer = () => {
        if (timerState.status !== 'running' || !timerState.startTime) return

        const now = Date.now()
        const sessionSeconds = Math.floor((now - timerState.startTime) / 1000)

        setTimerState(prev => ({
            ...prev,
            status: 'paused',
            startTime: null,
            accumulatedTime: prev.accumulatedTime + sessionSeconds
        }))
        setElapsedTime(timerState.accumulatedTime + sessionSeconds)
    }

    const resumeTimer = () => {
        if (timerState.status !== 'paused' || !timerState.jobId) return

        setTimerState(prev => ({
            ...prev,
            status: 'running',
            startTime: Date.now()
        }))
    }

    const stopTimer = () => {
        // Here we would save the session to the DB
        console.log(`Saving session for Job ${timerState.jobId}: ${elapsedTime} seconds`)

        setTimerState({
            status: 'idle',
            jobId: null,
            startTime: null,
            accumulatedTime: 0
        })
        setElapsedTime(0)
    }

    return (
        <TimerContext.Provider value={{
            timerState,
            elapsedTime,
            startTimer,
            pauseTimer,
            stopTimer,
            resumeTimer
        }}>
            {children}
        </TimerContext.Provider>
    )
}

export function useTimer() {
    const context = useContext(TimerContext)
    if (context === undefined) {
        throw new Error('useTimer must be used within a TimerProvider')
    }
    return context
}
