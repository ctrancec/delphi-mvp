'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function completeOnboarding(industry: string) {
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    const { error } = await supabase.auth.updateUser({
        data: {
            industry,
            onboarded: true
        }
    })

    if (error) {
        console.error('Onboarding error:', error)
        return { error: 'Failed to save preference' }
    }

    redirect('/dashboard')
}
