"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'
import { Briefcase, CreditCard, Store, UtensilsCrossed } from 'lucide-react'
import Cookies from 'js-cookie'

import { ToolId, UserRole } from '@/lib/types/tool-registry'

export type WorkspaceType = 'personal' | 'retail' | 'restaurant' | 'freelance' // Keeping for legacy/icon logic
export type SubscriptionTier = 'free' | 'pro' | 'business' | 'enterprise'

export interface Workspace {
    id: string
    name: string
    type: WorkspaceType
    tier: SubscriptionTier
    enabledTools: ToolId[]
    icon: any
}

interface WorkspaceContextType {
    activeWorkspace: Workspace
    workspaces: Workspace[]
    currentUserRole: UserRole
    switchWorkspace: (workspaceId: string) => void
    updateWorkspaceTier: (tier: SubscriptionTier) => void
    updateWorkspaceTools: (tools: ToolId[]) => void
    updateUserRole: (role: UserRole) => void
    addWorkspace: (workspace: Workspace) => void
    updateWorkspace: (id: string, updates: Partial<Workspace>) => void
}

const WORKSPACES: Workspace[] = [
    {
        id: 'ws-personal',
        name: 'Personal Wallet',
        type: 'personal',
        tier: 'free',
        enabledTools: ['overview', 'transactions', 'accounts'],
        icon: CreditCard
    },
    {
        id: 'ws-deli',
        name: 'Downtown Deli',
        type: 'restaurant',
        tier: 'business',
        enabledTools: ['overview', 'transactions', 'invoices', 'vendor_analysis', 'team', 'expenses', 'taxes', 'pos', 'menu', 'kitchen', 'inventory', 'shifts', 'orders'],
        icon: UtensilsCrossed
    },
    {
        id: 'ws-consulting',
        name: 'Tech Consulting',
        type: 'freelance',
        tier: 'business',
        enabledTools: ['overview', 'transactions', 'invoices', 'expenses', 'jobs', 'time_tracking', 'taxes'],
        icon: Briefcase
    }
]

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined)

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
    // Initialize lazily to avoid hydration mismatch, or use effect sync
    const [activeWorkspace, setActiveWorkspace] = useState<Workspace>(WORKSPACES[0])
    const [currentUserRole, setCurrentUserRole] = useState<UserRole>('owner')
    const [mockWorkspaces, setMockWorkspaces] = useState<Workspace[]>(WORKSPACES)

    // Load from LocalStorage on mount
    useEffect(() => {
        const storedWorkspaceId = localStorage.getItem('delphi_active_workspace')
        if (storedWorkspaceId) {
            const ws = mockWorkspaces.find(w => w.id === storedWorkspaceId)
            if (ws) {
                setActiveWorkspace(ws)
            }
        }

        // Also could load custom workspaces if we implemented creation persistence
    }, [mockWorkspaces])

    const switchWorkspace = (workspaceId: string) => {
        const ws = mockWorkspaces.find(w => w.id === workspaceId)
        if (ws) {
            setActiveWorkspace(ws)
            setCurrentUserRole('owner') // Reset role on switch
            localStorage.setItem('delphi_active_workspace', ws.id)
            Cookies.set('delphi_user_role', 'owner')
        }
    }

    const updateWorkspaceTier = (tier: SubscriptionTier) => {
        setActiveWorkspace(prev => ({
            ...prev,
            tier
        }))
    }

    const updateWorkspaceTools = (enabledTools: ToolId[]) => {
        setActiveWorkspace(prev => ({
            ...prev,
            enabledTools
        }))
    }

    const updateUserRole = (role: UserRole) => {
        setCurrentUserRole(role)
        Cookies.set('delphi_user_role', role)
    }

    const addWorkspace = (workspace: Workspace) => {
        setMockWorkspaces(prev => [...prev, workspace])
        // Optional: Persist custom workspaces list to localStorage too
    }

    return (
        <WorkspaceContext.Provider value={{
            activeWorkspace,
            workspaces: mockWorkspaces,
            currentUserRole,
            switchWorkspace,
            updateWorkspaceTier,
            updateWorkspaceTools,
            updateUserRole,
            addWorkspace,
            updateWorkspace: (id: string, updates: Partial<Workspace>) => {
                setMockWorkspaces(prev => prev.map(w => w.id === id ? { ...w, ...updates } : w))
                if (activeWorkspace.id === id) {
                    setActiveWorkspace(prev => ({ ...prev, ...updates }))
                }
            }
        }}>
            {children}
        </WorkspaceContext.Provider>
    )
}

export function useWorkspace() {
    const context = useContext(WorkspaceContext)
    if (context === undefined) {
        throw new Error('useWorkspace must be used within a WorkspaceProvider')
    }
    return context
}
