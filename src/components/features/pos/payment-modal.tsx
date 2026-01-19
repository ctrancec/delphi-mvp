"use client"

import React, { useState, useEffect } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { CreditCard, Loader2 } from 'lucide-react'

// Initialize Stripe outside component to avoid recreation
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

interface PaymentModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    amount: number
    onSuccess: () => void
}

function PaymentForm({ amount, onSuccess, setIsProcessing }: any) {
    const stripe = useStripe()
    const elements = useElements()
    const [message, setMessage] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!stripe || !elements) return

        setLoading(true)
        setIsProcessing(true)

        const { error, paymentIntent } = await stripe.confirmPayment({
            elements,
            confirmParams: {
                // Return URL is required, but we can prevent redirect if we handle it inline?
                // Actually Stripe demands a return_url for most payment methods.
                // For a SPA/Dashboard, we might want redirect: 'if_required'.
                return_url: window.location.origin + '/dashboard/pos',
            },
            redirect: 'if_required'
        })

        if (error) {
            setMessage(error.message ?? "An unexpected error occurred.")
            setLoading(false)
            setIsProcessing(false)
        } else if (paymentIntent && paymentIntent.status === 'succeeded') {
            setMessage("Payment succeeded!")
            setTimeout(() => {
                onSuccess() // Close modal and clear cart
            }, 1000)
        } else {
            setMessage("Payment processing...")
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
            <PaymentElement />
            {message && <div className="text-red-400 text-sm">{message}</div>}
            <Button
                disabled={loading || !stripe || !elements}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
            >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                Pay ${amount.toFixed(2)}
            </Button>
        </form>
    )
}

export function PaymentModal({ open, onOpenChange, amount, onSuccess }: PaymentModalProps) {
    const [clientSecret, setClientSecret] = useState("")
    const [isProcessing, setIsProcessing] = useState(false)

    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (open && amount > 0) {
            setError(null)
            setClientSecret("")

            fetch("/api/create-payment-intent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amount }),
            })
                .then((res) => res.json())
                .then((data) => {
                    if (data.error) {
                        setError(data.error)
                    } else {
                        setClientSecret(data.clientSecret)
                    }
                })
                .catch(err => setError("Network error: Failed to init payment"))
        }
    }, [open, amount])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px] bg-zinc-900 border-white/10 text-white">
                <DialogHeader>
                    <DialogTitle>Secure Checkout</DialogTitle>
                    <DialogDescription>
                        Enter card details to process ${amount.toFixed(2)}
                    </DialogDescription>
                </DialogHeader>

                {clientSecret ? (
                    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'night' } }}>
                        <PaymentForm
                            amount={amount}
                            onSuccess={onSuccess}
                            setIsProcessing={setIsProcessing}
                        />
                    </Elements>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
                        <div className="text-red-500 font-bold">Initialization Error</div>
                        <p className="text-sm text-muted-foreground">{error}</p>
                        <div className="flex gap-2 mt-4">
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                Close
                            </Button>
                            <Button
                                variant="secondary"
                                className="bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20"
                                onClick={() => {
                                    // Mock Success
                                    onSuccess()
                                }}
                            >
                                Force Success (Demo)
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-center py-10">
                        <Loader2 className="h-8 w-8 text-emerald-500 animate-spin" />
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
