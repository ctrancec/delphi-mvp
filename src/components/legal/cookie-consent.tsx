"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"

export function CookieConsent() {
    const [show, setShow] = useState(false)

    useEffect(() => {
        const consent = localStorage.getItem("delphi_cookie_consent")
        if (!consent) {
            setShow(true)
        }
    }, [])

    const accept = () => {
        localStorage.setItem("delphi_cookie_consent", "true")
        setShow(false)
    }

    if (!show) return null

    return (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4 animate-in slide-in-from-bottom-5 duration-500">
            <div className="max-w-4xl mx-auto bg-zinc-900/90 border border-white/10 backdrop-blur-md rounded-lg p-4 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-sm text-gray-300">
                    <p>
                        We use cookies to improve your experience and analyze traffic. By using Delphi, you agree to our
                        <a href="/legal/privacy" className="text-primary hover:underline ml-1">Privacy Policy</a>.
                    </p>
                </div>
                <div className="flex gap-3">
                    <Button variant="outline" size="sm" onClick={accept} className="border-white/10 hover:bg-white/10">
                        Decline
                    </Button>
                    <Button size="sm" onClick={accept} className="bg-primary hover:bg-primary/90 text-white">
                        Accept All
                    </Button>
                </div>
            </div>
        </div>
    )
}
