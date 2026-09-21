"use client"

import { useCallback, useState, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"

const KEY = "delphi_cookie_consent"

/**
 * Whether consent has already been recorded.
 *
 * Read through useSyncExternalStore rather than an effect, so there is no
 * cascading render on mount, and wrapped in try/catch because localStorage
 * *throws* rather than returning null when site data is blocked — in a private
 * window that would take the banner, and the page under it, down.
 *
 * The server snapshot is `true`: assuming consent means the banner never
 * flashes into view and back out during hydration for someone who dismissed it.
 */
function hasConsented(): boolean {
    try {
        return window.localStorage.getItem(KEY) !== null
    } catch {
        return true
    }
}

/** Consent never changes from outside this tab, so there is nothing to watch. */
const subscribe = () => () => {}

export function CookieConsent() {
    const stored = useSyncExternalStore(subscribe, hasConsented, () => true)
    const [dismissed, setDismissed] = useState(false)

    const accept = useCallback(() => {
        try {
            window.localStorage.setItem(KEY, "true")
        } catch {
            // Blocked storage means the choice cannot be remembered. Honour it
            // for this session rather than refusing to close.
        }
        setDismissed(true)
    }, [])

    if (stored || dismissed) return null

    return (
        <div
            className="fixed bottom-0 left-0 right-0 z-30 p-4 animate-in slide-in-from-bottom-5 duration-500"
            // Clears the cover panel's tab bar, which is the only navigation
            // that surface has. Zero once the rail takes over at `inner`.
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px) + var(--tabbar-height, 0px))' }}
        >
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
