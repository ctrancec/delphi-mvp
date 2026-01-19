"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'
import { Briefcase, CreditCard, Store, UtensilsCrossed, Check, Loader2 } from 'lucide-react'
import Cookies from 'js-cookie'
import { createClient } from '@/lib/supabase/client'
import { ToolId, UserRole } from '@/lib/types/tool-registry'

export type WorkspaceType = 'personal' | 'retail' | 'restaurant' | 'freelance'
export type SubscriptionTier = 'free' | 'pro' | 'business' | 'enterprise'

export interface Workspace {
    id: string
    name: string
    type: WorkspaceType
    tier: SubscriptionTier
    enabledTools: ToolId[]
    icon: any
    owner_id?: string
    role: UserRole // [NEW] Store current user's role in this workspace
}

interface WorkspaceContextType {
    activeWorkspace: Workspace
    workspaces: Workspace[]
    currentUserRole: UserRole
    isLoading: boolean
    switchWorkspace: (workspaceId: string) => void
    updateWorkspaceTier: (tier: SubscriptionTier) => void
    updateWorkspaceTools: (tools: ToolId[]) => void
    updateUserRole: (role: UserRole) => void
    addWorkspace: (name: string, type: WorkspaceType) => Promise<void>
    updateWorkspace: (id: string, updates: Partial<Workspace>) => Promise<void>
    deleteWorkspace: (id: string) => Promise<void>
    userSubscriptionTier: SubscriptionTier
    features: {
        canCreateBusiness: boolean
        canCreateFreelance: boolean
    }
}

// Icon mapping helper
const getIconForType = (type: string) => {
    switch (type) {
        case 'personal': return CreditCard
        case 'restaurant': return UtensilsCrossed
        case 'retail': return Store
        case 'freelance': return Briefcase
        default: return Briefcase
    }
}

const DEFAULT_WORKSPACE: Workspace = {
    id: 'loading',
    name: 'Loading...',
    type: 'personal',
    tier: 'free',
    enabledTools: [],
    icon: Loader2,
    role: 'member' // Default safety
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined)

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
    const supabase = createClient()
    const [activeWorkspace, setActiveWorkspace] = useState<Workspace>(DEFAULT_WORKSPACE)
    const [workspaces, setWorkspaces] = useState<Workspace[]>([])
    const [currentUserRole, setCurrentUserRole] = useState<UserRole>('member')
    const [isLoading, setIsLoading] = useState(true)

    const [userSubscriptionTier, setUserSubscriptionTier] = useState<SubscriptionTier>('free') // Default to free (Secure by default)

    // [NEW] Computed Features
    const features = {
        canCreateBusiness: userSubscriptionTier === 'business' || userSubscriptionTier === 'enterprise',
        canCreateFreelance: userSubscriptionTier === 'pro' || userSubscriptionTier === 'business' || userSubscriptionTier === 'enterprise',
    }

    // Fetch workspaces on mount
    useEffect(() => {
        const fetchWorkspaces = async () => {
            if (!supabase) return

            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                setIsLoading(false)
                return
            }

            // [NEW] Mock Subscription Logic based on Email
            if (user.email === 'curtischan000@gmail.com') {
                console.log("WorkspaceContext: User is curtischan000@gmail.com -> Enforcing FREE tier")
                setUserSubscriptionTier('free')
            } else {
                console.log("WorkspaceContext: User is " + user.email + " -> Defaulting to BUSINESS tier")
                setUserSubscriptionTier('business')
            }

            // [NEW] Fetch Workspaces + Memberships to get Role
            console.log("WorkspaceContext: Fetching workspaces for user", user.id)

            // 1. Fetch Workspaces
            const { data: dbWorkspaces, error: wsError } = await supabase
                .from('workspaces')
                .select('*')
                .order('created_at', { ascending: true })

            if (wsError) {
                console.error('Error fetching workspaces:', wsError)
                setIsLoading(false)
                return
            }

            // 2. Fetch My Memberships (to get roles)
            const { data: myMemberships, error: memError } = await supabase
                .from('workspace_members')
                .select('workspace_id, role')
                .eq('user_id', user.id)

            if (memError) {
                console.error('Error fetching memberships:', memError)
            }

            // Create a lookup map for roles
            const roleMap = new Map<string, UserRole>()
            if (myMemberships) {
                myMemberships.forEach(m => roleMap.set(m.workspace_id, m.role as UserRole))
            }

            if (dbWorkspaces && dbWorkspaces.length > 0) {
                const mappedWorkspaces: Workspace[] = dbWorkspaces.map(ws => ({
                    id: ws.id,
                    name: ws.name,
                    type: ws.type as WorkspaceType,
                    tier: ws.tier as SubscriptionTier,
                    enabledTools: (ws.enabled_tools as ToolId[]) || [],
                    icon: getIconForType(ws.type),
                    owner_id: ws.owner_id,
                    role: roleMap.get(ws.id) || 'member' // Default to member if not found
                }))

                setWorkspaces(mappedWorkspaces)

                // Restore active workspace from local storage or default to first
                const storedId = localStorage.getItem('delphi_active_workspace')
                const found = mappedWorkspaces.find(w => w.id === storedId) || mappedWorkspaces[0]

                setActiveWorkspace(found)
                setCurrentUserRole(found.role) // [NEW] Set initial role
            } else {
                // No workspaces found?
                console.log('WorkspaceContext: No workspaces found. Setting active workspace to "No Workspace" state.')
                setActiveWorkspace({ ...DEFAULT_WORKSPACE, name: 'No Workspace' })
            }

            setIsLoading(false)
        }

        fetchWorkspaces()
    }, [])

    const switchWorkspace = (workspaceId: string) => {
        const ws = workspaces.find(w => w.id === workspaceId)
        if (ws) {
            setActiveWorkspace(ws)
            setCurrentUserRole(ws.role) // [NEW] Update role on switch
            localStorage.setItem('delphi_active_workspace', ws.id)
        }
    }

    const addWorkspace = async (name: string, type: WorkspaceType) => {
        if (!supabase) {
            console.error("addWorkspace: Supabase client missing")
            throw new Error("System Error: Database connection not active.")
        }

        const { data: { user }, error: userError } = await supabase.auth.getUser()
        if (userError || !user) {
            console.error("addWorkspace: User missing", userError)
            throw new Error("Session Expired: Please login again.")
        }

        // Define default tools based on type
        let tools: string[] = ['overview', 'settings']
        if (type === 'personal') tools = [...tools, 'transactions', 'accounts']
        if (type === 'restaurant') tools = [...tools, 'transactions', 'pos', 'menu', 'kitchen', 'orders', 'shifts']
        if (type === 'retail') tools = [...tools, 'transactions', 'pos', 'inventory', 'orders']
        if (type === 'freelance') tools = [...tools, 'transactions', 'invoices', 'jobs', 'time_tracking']

        const { data, error } = await supabase
            .from('workspaces')
            .insert({
                name,
                type,
                tier: 'free',
                owner_id: user.id,
                enabled_tools: tools
            })
            .select()
            .single()

        if (error) {
            console.error('SUPABASE CREATE WORKSPACE ERROR:', error)
            throw new Error(`DB Error: ${error.message} (Code: ${error.code})`)
        }

        if (data) {
            const mapped: Workspace = {
                id: data.id,
                name: data.name,
                type: data.type as WorkspaceType,
                tier: data.tier as SubscriptionTier,
                enabledTools: (data.enabled_tools as ToolId[]) || [],
                icon: getIconForType(data.type),
                owner_id: data.owner_id,
                role: 'owner' // Creator is owner
            }
            setWorkspaces(prev => [...prev, mapped])
            setActiveWorkspace(mapped) // Switch to new
            setCurrentUserRole('owner')
        }
    }

    const updateWorkspace = async (id: string, updates: Partial<Workspace>) => {
        // Optimistic update
        setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, ...updates } : w))
        if (activeWorkspace.id === id) {
            setActiveWorkspace(prev => ({ ...prev, ...updates }))
        }

        // DB Update
        if (supabase) {
            const dbUpdates: any = {}
            if (updates.name) dbUpdates.name = updates.name
            if (updates.tier) dbUpdates.tier = updates.tier
            if (updates.enabledTools) dbUpdates.enabled_tools = updates.enabledTools

            await supabase.from('workspaces').update(dbUpdates).eq('id', id)
        }
    }

    const deleteWorkspace = async (id: string) => {
        if (!supabase) return

        const { error } = await supabase.from('workspaces').delete().eq('id', id)

        if (error) {
            console.error('Delete Workspace Error:', error)
            throw new Error(error.message)
        }

        // Update User State
        const remaining = workspaces.filter(w => w.id !== id)
        setWorkspaces(remaining)

        // If we deleted the active one, switch to another
        if (activeWorkspace.id === id) {
            if (remaining.length > 0) {
                setActiveWorkspace(remaining[0])
                setCurrentUserRole(remaining[0].role)
                localStorage.setItem('delphi_active_workspace', remaining[0].id)
            } else {
                // No workspaces left
                console.log('Last workspace deleted. Setting active workspace to "No Workspace" state.')
                setActiveWorkspace({ ...DEFAULT_WORKSPACE, name: 'No Workspace' })
                localStorage.removeItem('delphi_active_workspace')
            }
        }
    }

    const updateWorkspaceTier = (tier: SubscriptionTier) => {
        updateWorkspace(activeWorkspace.id, { tier })
    }

    const updateWorkspaceTools = (enabledTools: ToolId[]) => {
        updateWorkspace(activeWorkspace.id, { enabledTools })
    }

    const updateUserRole = (role: UserRole) => {
        setCurrentUserRole(role)
        Cookies.set('delphi_user_role', role)
    }

    return (
        <WorkspaceContext.Provider value={{
            activeWorkspace,
            workspaces,
            currentUserRole,
            isLoading,
            switchWorkspace,
            updateWorkspaceTier,
            updateWorkspaceTools,
            updateUserRole,
            addWorkspace,
            updateWorkspace,
            deleteWorkspace,
            userSubscriptionTier,
            features
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
