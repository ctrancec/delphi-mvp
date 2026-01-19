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

    redirect('/dashboard')
}

export async function signup(formData: FormData) {

    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const supabase = await createClient()

    if (!supabase) {
        return redirect('/login?error=Authentication not configured (Missing Env Vars)')
    }

    const { error } = await supabase.auth.signUp({
        email,
        password,
    })

    if (error) {
        return redirect(`/login?error=${encodeURIComponent(error.message)}`)
    }

    redirect('/onboarding')
}
