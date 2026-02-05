"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'

interface JuniorContextType {
    isJuniorMode: boolean
    pinCode: string | null
    enterJuniorMode: () => void
    exitJuniorMode: (pin: string) => boolean
    updatePin: (pin: string) => void
    allowance: number
    updateAllowance: (amount: number) => void
    hasPin: boolean
}

const JuniorContext = createContext<JuniorContextType | undefined>(undefined)

export function JuniorProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const [isJuniorMode, setIsJuniorMode] = useState(false)
    const [pinCode, setPinCode] = useState<string | null>(null)
    const [allowance, setAllowance] = useState(10.00)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        // Load from local storage on mount
        const storedPin = localStorage.getItem('delphi_junior_pin')
        const storedMode = localStorage.getItem('delphi_junior_mode') === 'true'
        const storedAllowance = parseFloat(localStorage.getItem('delphi_junior_allowance') || '10.00')

        if (storedPin) setPinCode(storedPin)
        setIsJuniorMode(storedMode)
        setAllowance(storedAllowance)
        setIsLoading(false)
    }, [])

    useEffect(() => {
        if (isLoading) return

        // Enforce Junior Mode routing
        if (isJuniorMode) {
            if (!pathname?.startsWith('/junior')) {
                console.log("JuniorProvider: Enforcing Junior Mode, redirecting to /junior")
                router.push('/junior')
            }
        }
    }, [isJuniorMode, pathname, isLoading, router])

    const enterJuniorMode = () => {
        if (!pinCode) {
            // Should warn caller to set PIN first
            console.error("Cannot enter Junior Mode without a PIN")
            return
        }
        setIsJuniorMode(true)
        localStorage.setItem('delphi_junior_mode', 'true')
        router.push('/junior')
    }

    const exitJuniorMode = (inputPin: string) => {
        if (inputPin === pinCode) {
            setIsJuniorMode(false)
            localStorage.setItem('delphi_junior_mode', 'false')
            router.push('/dashboard')
            return true
        }
        return false
    }

    const updatePin = (newPin: string) => {
        setPinCode(newPin)
        localStorage.setItem('delphi_junior_pin', newPin)
    }

    const updateAllowance = (amount: number) => {
        setAllowance(amount)
        localStorage.setItem('delphi_junior_allowance', amount.toString())
    }

    return (
        <JuniorContext.Provider value={{
            isJuniorMode,
            pinCode,
            enterJuniorMode,
            exitJuniorMode,
            updatePin,
            allowance,
            updateAllowance,
            hasPin: !!pinCode
        }}>
            {children}
        </JuniorContext.Provider>
    )
}

export function useJunior() {
    const context = useContext(JuniorContext)
    if (context === undefined) {
        throw new Error('useJunior must be used within a JuniorProvider')
    }
    return context
}
