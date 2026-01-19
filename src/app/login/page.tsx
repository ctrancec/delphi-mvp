"use client"

import { login, signup } from './actions'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertCircle } from 'lucide-react'

function LoginContent() {
    const searchParams = useSearchParams()
    const mode = searchParams.get('mode')
    const [isLogin, setIsLogin] = useState(mode !== 'signup')
    const error = searchParams.get('error')

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] p-4">
            <Card className="w-full max-w-md p-8 bg-black/40 border-white/10 backdrop-blur-xl">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
                        {isLogin ? 'Welcome back' : 'Create an account'}
                    </h1>
                    <p className="text-muted-foreground">
                        {isLogin ? 'Enter your credentials to access your workspace.' : 'Start your journey with Delphi today.'}
                    </p>
                </div>

                {error && (
                    <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                    </div>
                )}

                <form className="space-y-6">
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" name="email" type="email" placeholder="name@example.com" required className="bg-white/5 border-white/10" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <Input id="password" name="password" type="password" required className="bg-white/5 border-white/10" />
                    </div>

                    <div className="flex flex-col gap-4 pt-4">
                        {isLogin ? (
                            <Button formAction={login} className="w-full font-bold">Sign In</Button>
                        ) : (
                            <Button formAction={signup} className="w-full font-bold bg-emerald-600 hover:bg-emerald-700">Sign Up</Button>
                        )}

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-white/10" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-[#0a0a0a] px-2 text-muted-foreground">Or continue with</span>
                            </div>
                        </div>

                        <Button
                            type="button"
                            variant="outline"
                            className="w-full border-white/10 hover:bg-white/5"
                            onClick={async () => {
                                const { createClient } = await import('@/lib/supabase/client')
                                const supabase = createClient()
                                if (supabase) {
                                    await supabase.auth.signInWithOAuth({
                                        provider: 'google',
                                        options: {
                                            redirectTo: `${window.location.origin}/auth/callback`
                                        }
                                    })
                                }
                            }}
                        >
                            <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512"><path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"></path></svg>
                            Google
                        </Button>
                    </div>
                </form>

                <div className="mt-8 text-center text-sm">
                    <span className="text-muted-foreground">
                        {isLogin ? "Don't have an account? " : "Already have an account? "}
                    </span>
                    <button
                        onClick={() => setIsLogin(!isLogin)}
                        className="text-primary hover:underline font-medium"
                    >
                        {isLogin ? 'Sign up' : 'Log in'}
                    </button>
                </div>
            </Card>
        </div>
    )
}

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white">Loading...</div>}>
            <LoginContent />
        </Suspense>
    )
}
