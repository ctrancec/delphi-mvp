'use server'

import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

export async function login(formData: FormData) {

    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const supabase = await createClient()

    if (!supabase) {
        return redirect('/login?error=Authentication not configured (Missing Env Vars)')
    }

    const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
    })

    if (error) {
        return redirect(`/login?error=${encodeURIComponent(error.message)}`)
    }

    redirect('/dashboard/delphi')
}

export async function signup(formData: FormData) {

    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const supabase = await createClient()

    if (!supabase) {
        return redirect('/login?error=Authentication not configured (Missing Env Vars)')
    }

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
    })

    if (error) {
        return redirect(`/login?error=${encodeURIComponent(error.message)}`)
    }

    // With email confirmation switched on, signUp returns no session — the
    // account exists but is not signed in yet. Sending them onward would just
    // bounce off the auth middleware, so say what has to happen instead.
    if (!data.session) {
        return redirect(
            `/login?message=${encodeURIComponent('Check your email to confirm your account, then sign in.')}`
        )
    }

    redirect('/dashboard/delphi')
}
