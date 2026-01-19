"use client"

import React, { useState } from 'react'
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Calendar, ChevronLeft, ChevronRight, Clock, Plus, Users, X } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWorkspace } from '@/lib/contexts/workspace-context'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// Mock Data
type Shift = {
    id: string
    staffId: string
    day: string
    startTime: string
    endTime: string
    role: string
}

type Staff = {
    id: string
    name: string
    role: string
    color: string
}

type TimeOff = {
    id: string
    staffId: string
    date: string // ISO Date YYYY-MM-DD
    reason: string
}

const INITIAL_STAFF: Staff[] = [
    { id: 's1', name: 'Alice', role: 'Manager', color: 'bg-purple-500' },
    { id: 's2', name: 'Bob', role: 'Barista', color: 'bg-blue-500' },
    { id: 's3', name: 'Charlie', role: 'Server', color: 'bg-green-500' },
    { id: 's4', name: 'David', role: 'Chef', color: 'bg-red-500' },
    { id: 's5', name: 'Eve', role: 'Host', color: 'bg-yellow-500' },
]

const INITIAL_SHIFTS: Shift[] = [
    { id: '1', staffId: 's1', day: 'Mon', startTime: '09:00', endTime: '17:00', role: 'Manager' },
    { id: '2', staffId: 's2', day: 'Mon', startTime: '11:00', endTime: '19:00', role: 'Barista' },
    { id: '3', staffId: 's3', day: 'Tue', startTime: '09:00', endTime: '15:00', role: 'Server' },
    { id: '4', staffId: 's4', day: 'Wed', startTime: '16:00', endTime: '23:00', role: 'Chef' },
    { id: '5', staffId: 's2', day: 'Thu', startTime: '09:00', endTime: '17:00', role: 'Barista' },
    { id: '6', staffId: 's1', day: 'Fri', startTime: '09:00', endTime: '17:00', role: 'Manager' },
]

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function ShiftsPage() {
    const { currentUserRole } = useWorkspace()
    const canEdit = ['owner', 'manager'].includes(currentUserRole)

    const [shifts, setShifts] = useState<Shift[]>(INITIAL_SHIFTS)
    const [timeOffs, setTimeOffs] = useState<TimeOff[]>([])

    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [selectedDay, setSelectedDay] = useState<string>('Mon')
    const [selectedDate, setSelectedDate] = useState<string>('') // For Month View clicks
    const [viewMode, setViewMode] = useState<'week' | 'month'>('week')
    const [activeTab, setActiveTab] = useState('shift')

    // Form State
    const [newShift, setNewShift] = useState({ staffId: '', startTime: '09:00', endTime: '17:00' })
    const [newTimeOff, setNewTimeOff] = useState({ staffId: '', reason: 'Holiday' })

    const handleAddShift = () => {
        if (!newShift.staffId) return

        const staffMember = INITIAL_STAFF.find(s => s.id === newShift.staffId)
        if (!staffMember) return

        const shift: Shift = {
            id: Math.random().toString(36).substr(2, 9),
            staffId: newShift.staffId,
            day: selectedDay,
            startTime: newShift.startTime,
            endTime: newShift.endTime,
            role: staffMember.role
        }

        setShifts([...shifts, shift])
        setIsDialogOpen(false)
    }

    const handleAddTimeOff = () => {
        if (!newTimeOff.staffId || !selectedDate) return

        const record: TimeOff = {
            id: Math.random().toString(36).substr(2, 9),
            staffId: newTimeOff.staffId,
            date: selectedDate,
            reason: newTimeOff.reason
        }

        setTimeOffs([...timeOffs, record])
        setIsDialogOpen(false)
    }

    const handleDeleteShift = (id: string) => {
        if (!canEdit) return
        setShifts(shifts.filter(s => s.id !== id))
    }

    const handleDeleteTimeOff = (id: string) => {
        if (!canEdit) return
        setTimeOffs(timeOffs.filter(t => t.id !== id))
    }

    const getStaffName = (id: string) => INITIAL_STAFF.find(s => s.id === id)?.name || 'Unknown'
    const getStaffColor = (id: string) => INITIAL_STAFF.find(s => s.id === id)?.color || 'bg-gray-500'

    // Mock Month Generation (Feb 2026)
    // Starts on Sunday Feb 1
    const generateMonthDays = () => {
        const days = []
        // Feb 2026 has 28 days. Feb 1 is a Sunday.
        // We'll just map 1-28.
        for (let i = 1; i <= 28; i++) {
            // Determine day of week for mapping shifts
            // Feb 1 = Sunday, Feb 2 = Mon, etc.
            const date = new Date(2026, 1, i) // Month is 0-indexed
            const dayName = DAYS[(date.getDay() + 6) % 7] // Shift 0-6 (Sun-Sat) to 0-6 (Mon-Sun) to match our DAYS array
            // Actually our DAYS array is Mon-Sun
            // date.getDay(): 0=Sun, 1=Mon...
            // DAYS: 0=Mon, 1=Tue...
            // Map: Sun(0) -> 6, Mon(1) -> 0
            const dayIndex = date.getDay() === 0 ? 6 : date.getDay() - 1
            const dayStr = DAYS[dayIndex]

            days.push({
                date: i,
                dayOfWeek: dayStr,
                iso: `2026-02-${i.toString().padStart(2, '0')}`
            })
        }
        return days
    }

    const monthDays = generateMonthDays()

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Staff Schedule</h2>
                    <p className="text-muted-foreground">
                        Manage weekly shifts and assignments.
                    </p>
                </div>
                <div className="flex gap-2">
                    <div className="flex p-1 bg-white/5 rounded-lg border border-white/10 mr-4">
                        <button
                            onClick={() => setViewMode('week')}
                            className={cn(
                                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                                viewMode === 'week' ? "bg-primary text-white" : "text-muted-foreground hover:text-white"
                            )}
                        >
                            Week
                        </button>
                        <button
                            onClick={() => setViewMode('month')}
                            className={cn(
                                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                                viewMode === 'month' ? "bg-primary text-white" : "text-muted-foreground hover:text-white"
                            )}
                        >
                            Month
                        </button>
                    </div>

                    {canEdit && (
                        <Button variant="outline" className="border-white/10 hover:bg-white/5">
                            <Users className="h-4 w-4 mr-2" />
                            Manage Staff
                        </Button>
                    )}

                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                        {canEdit && (
                            <DialogTrigger asChild>
                                <Button className="gap-2 bg-primary hover:bg-primary/90 text-white">
                                    <Plus className="h-4 w-4" />
                                    Add Shift
                                </Button>
                            </DialogTrigger>
                        )}
                        <DialogContent className="sm:max-w-[425px] bg-zinc-950 border-white/10 text-white">
                            <DialogHeader>
                                <DialogTitle>Manage Schedule</DialogTitle>
                                <DialogDescription className="text-gray-400">
                                    {selectedDate ? `Editing for ${selectedDate}` : 'Add a new shift or time off.'}
                                </DialogDescription>
                            </DialogHeader>

                            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                                <TabsList className="grid w-full grid-cols-2 bg-white/5">
                                    <TabsTrigger value="shift">Add Shift</TabsTrigger>
                                    <TabsTrigger value="timeoff" disabled={!selectedDate}>Add Time Off</TabsTrigger>
                                </TabsList>
                                <TabsContent value="shift" className="space-y-4 py-4">
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor="day" className="text-right">Day</Label>
                                        <Select
                                            value={selectedDay}
                                            onValueChange={setSelectedDay}
                                            disabled={!!selectedDate} // Locked if clicked from month view
                                        >
                                            <SelectTrigger className="col-span-3 bg-white/5 border-white/10 text-white">
                                                <SelectValue placeholder="Select Day" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-zinc-950 border-white/10 text-white">
                                                {DAYS.map(day => (
                                                    <SelectItem key={day} value={day}>{day}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor="staff" className="text-right">Staff</Label>
                                        <Select
                                            value={newShift.staffId}
                                            onValueChange={(v) => setNewShift({ ...newShift, staffId: v })}
                                        >
                                            <SelectTrigger className="col-span-3 bg-white/5 border-white/10 text-white">
                                                <SelectValue placeholder="Select Staff" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-zinc-950 border-white/10 text-white">
                                                {INITIAL_STAFF.map(staff => (
                                                    <SelectItem key={staff.id} value={staff.id}>{staff.name} ({staff.role})</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor="start" className="text-right">Start</Label>
                                        <Input
                                            id="start"
                                            type="time"
                                            className="col-span-3 bg-white/5 border-white/10 text-white"
                                            value={newShift.startTime}
                                            onChange={(e) => setNewShift({ ...newShift, startTime: e.target.value })}
                                        />
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor="end" className="text-right">End</Label>
                                        <Input
                                            id="end"
                                            type="time"
                                            className="col-span-3 bg-white/5 border-white/10 text-white"
                                            value={newShift.endTime}
                                            onChange={(e) => setNewShift({ ...newShift, endTime: e.target.value })}
                                        />
                                    </div>
                                    <Button type="button" onClick={handleAddShift} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                                        Save Shift
                                    </Button>
                                </TabsContent>
                                <TabsContent value="timeoff" className="space-y-4 py-4">
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label className="text-right">Date</Label>
                                        <div className="col-span-3 text-sm text-white font-mono bg-white/5 p-2 rounded border border-white/10">
                                            {selectedDate}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor="staff-off" className="text-right">Staff</Label>
                                        <Select
                                            value={newTimeOff.staffId}
                                            onValueChange={(v) => setNewTimeOff({ ...newTimeOff, staffId: v })}
                                        >
                                            <SelectTrigger className="col-span-3 bg-white/5 border-white/10 text-white">
                                                <SelectValue placeholder="Select Staff" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-zinc-950 border-white/10 text-white">
                                                {INITIAL_STAFF.map(staff => (
                                                    <SelectItem key={staff.id} value={staff.id}>{staff.name} ({staff.role})</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor="reason" className="text-right">Reason</Label>
                                        <Select
                                            value={newTimeOff.reason}
                                            onValueChange={(v) => setNewTimeOff({ ...newTimeOff, reason: v })}
                                        >
                                            <SelectTrigger className="col-span-3 bg-white/5 border-white/10 text-white">
                                                <SelectValue placeholder="Select Reason" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-zinc-950 border-white/10 text-white">
                                                <SelectItem value="Holiday">Holiday</SelectItem>
                                                <SelectItem value="Sick">Sick Leave</SelectItem>
                                                <SelectItem value="Personal">Personal</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="p-3 text-xs text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
                                        This will remove any recurring shifts for this staff member on this specific date.
                                    </div>
                                    <Button type="button" onClick={handleAddTimeOff} className="w-full bg-red-600 hover:bg-red-700 text-white">
                                        Confirm Time Off
                                    </Button>
                                </TabsContent>
                            </Tabs>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <Card className="bg-black/40 border-white/10 backdrop-blur-xl">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                    <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" className="hover:bg-white/10">
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <div className="text-center">
                            <h3 className="font-semibold text-lg">{viewMode === 'week' ? 'Week of Feb 9, 2026' : 'February 2026'}</h3>
                        </div>
                        <Button variant="ghost" size="icon" className="hover:bg-white/10">
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="border-emerald-500/20 text-emerald-500 bg-emerald-500/10">
                            Fully Staffed
                        </Badge>
                    </div>
                </CardHeader>
                <CardContent>
                    {viewMode === 'week' ? (
                        <div className="grid grid-cols-7 gap-4 min-w-[800px]">
                            {DAYS.map((day, i) => {
                                // Calculate actual date for this week (Feb 9 starts Monday)
                                const currentIsoDate = `2026-02-${(9 + i).toString().padStart(2, '0')}`

                                // Get standard shifts
                                const standardShifts = shifts.filter(s => s.day === day).sort((a, b) => a.startTime.localeCompare(b.startTime))

                                // Apply Time Off Overrides
                                const activeShifts = standardShifts.filter(shift => {
                                    return !timeOffs.some(t => t.staffId === shift.staffId && t.date === currentIsoDate)
                                })

                                // Get Time Offs for this day
                                const dayTimeOffs = timeOffs.filter(t => t.date === currentIsoDate)

                                return (
                                    <div key={day} className="space-y-4">
                                        <div className="text-center p-3 rounded-lg bg-white/5 border border-white/5">
                                            <div className="text-sm font-medium text-muted-foreground">{day}</div>
                                            <div className="text-xs text-muted-foreground mt-1">{activeShifts.length} Shifts</div>
                                        </div>

                                        <div className="space-y-3 min-h-[200px]">
                                            {/* Render Active Shifts */}
                                            {activeShifts.map((shift) => (
                                                <div key={shift.id} className="group relative p-3 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 transition-colors">
                                                    {canEdit && (
                                                        <button
                                                            onClick={() => handleDeleteShift(shift.id)}
                                                            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </button>
                                                    )}
                                                    <div className="flex items-center gap-3 mb-2">
                                                        <Avatar className="h-6 w-6">
                                                            <AvatarFallback className={cn("text-[10px] text-white", getStaffColor(shift.staffId))}>
                                                                {getStaffName(shift.staffId)[0]}
                                                            </AvatarFallback>
                                                        </Avatar>
                                                        <div className="overflow-hidden">
                                                            <div className="text-sm font-medium truncate">{getStaffName(shift.staffId)}</div>
                                                            <div className="text-[10px] text-muted-foreground truncate">{shift.role}</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-xs font-mono text-emerald-400 bg-emerald-500/10 p-1.5 rounded w-fit">
                                                        <Clock className="h-3 w-3" />
                                                        {shift.startTime} - {shift.endTime}
                                                    </div>
                                                </div>
                                            ))}

                                            {/* Render Time Offs */}
                                            {dayTimeOffs.map((t) => (
                                                <div key={t.id} className="group relative p-3 rounded-lg bg-red-500/10 border border-red-500/20 hover:border-red-500/40 transition-colors">
                                                    {canEdit && (
                                                        <button
                                                            onClick={() => handleDeleteTimeOff(t.id)}
                                                            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </button>
                                                    )}
                                                    <div className="flex items-center gap-2">
                                                        <div className={cn("w-2 h-2 rounded-full", getStaffColor(t.staffId))} />
                                                        <span className="text-xs font-medium text-red-200">{getStaffName(t.staffId)}</span>
                                                    </div>
                                                    <div className="text-[10px] text-red-400 mt-1 uppercase font-bold tracking-wider">
                                                        {t.reason}
                                                    </div>
                                                </div>
                                            ))}

                                            {canEdit && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        setSelectedDay(day)
                                                        setSelectedDate(currentIsoDate)
                                                        setIsDialogOpen(true)
                                                    }}
                                                    className="w-full text-xs text-muted-foreground border-dashed border border-white/10 hover:border-white/20 hover:text-white h-8"
                                                >
                                                    <Plus className="h-3 w-3 mr-1" /> Add
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="grid grid-cols-7 gap-px bg-white/10 rounded-lg overflow-hidden border border-white/10">
                            {/* Days Header */}
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                                <div key={day} className="p-2 text-center text-xs font-medium bg-black/40 text-muted-foreground">
                                    {day}
                                </div>
                            ))}

                            {/* Empty cells for start of month (Feb 1 starts on Sunday, so 0 padding needed) */}

                            {/* Month Days */}
                            {monthDays.map(day => {
                                // Standard Shifts
                                const standardShifts = shifts.filter(s => s.day === day.dayOfWeek)
                                // Filter out Time Offs
                                const activeShifts = standardShifts.filter(shift => {
                                    return !timeOffs.some(t => t.staffId === shift.staffId && t.date === day.iso)
                                })
                                // Get Time Offs
                                const dayTimeOffs = timeOffs.filter(t => t.date === day.iso)

                                return (
                                    <div key={day.date} className="min-h-[100px] p-2 bg-black/20 hover:bg-white/5 transition-colors group relative border-t border-white/5">
                                        <span className={cn(
                                            "text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1",
                                            day.date === 16 ? "bg-primary text-white" : "text-muted-foreground"
                                        )}>
                                            {day.date}
                                        </span>

                                        <div className="space-y-1">
                                            {/* Active Shifts */}
                                            {activeShifts.slice(0, 3).map(shift => (
                                                <div key={shift.id + day.date} className="flex items-center gap-1.5 text-[10px] p-1 rounded bg-white/5 border border-white/5">
                                                    <div className={cn("w-1.5 h-1.5 rounded-full", getStaffColor(shift.staffId))} />
                                                    <span className="truncate max-w-[80px] text-gray-300">{getStaffName(shift.staffId)}</span>
                                                </div>
                                            ))}

                                            {/* Holidays */}
                                            {dayTimeOffs.map(t => (
                                                <div key={t.id} className="flex items-center gap-1.5 text-[10px] p-1 rounded bg-red-500/10 border border-red-500/20">
                                                    <div className={cn("w-1.5 h-1.5 rounded-full", getStaffColor(t.staffId))} />
                                                    <span className="truncate max-w-[80px] text-red-300 font-medium">OFF</span>
                                                </div>
                                            ))}

                                            {(activeShifts.length + dayTimeOffs.length) > 3 && (
                                                <div className="text-[10px] text-muted-foreground pl-1">
                                                    +{activeShifts.length + dayTimeOffs.length - 3} more
                                                </div>
                                            )}
                                        </div>

                                        {canEdit && (
                                            <button
                                                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded"
                                                onClick={() => {
                                                    setSelectedDay(day.dayOfWeek)
                                                    setSelectedDate(day.iso)
                                                    setIsDialogOpen(true)
                                                }}
                                            >
                                                <Plus className="h-3 w-3 text-muted-foreground" />
                                            </button>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

function cn(...classes: (string | undefined | null | false)[]) {
    return classes.filter(Boolean).join(' ')
}
