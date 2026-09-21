import { NextResponse } from 'next/server'
// The client you created from the Server-Side Auth instructions
import { createClient } from '@/lib/supabase/server'

/**
 * Where Supabase sends people after they confirm their email.
 *
 * This is the first authenticated request a new account ever makes, so it fails
 * visibly rather than throwing: an unhandled error here strands someone who has
 * already clicked the link in their inbox, with no obvious way back.
 */
export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')

    // Only ever redirect within this app. Requiring a single leading slash and
    // no second one keeps `//evil.com` from being read as a host downstream.
    const requested = searchParams.get('next') ?? '/dashboard/delphi'
    let next = /^\/(?!\/)/.test(requested) ? requested : '/dashboard/delphi'

    // A recovery link has one destination regardless of what it asked for:
    // someone who cannot sign in must not be dropped on a page that needs them
    // to sign in.
    if (searchParams.get('type') === 'recovery') next = '/account/new-password'

    if (code) {
        const supabase = await createClient()
        if (!supabase) {
            return NextResponse.redirect(`${origin}/login?error=supabase_not_configured`)
        }

        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            return NextResponse.redirect(`${origin}${next}`)
        }
        console.error('[auth] code exchange failed:', error.message)
    }

    // return the user to an error page with instructions
    return NextResponse.redirect(`${origin}/login?error=auth_code_error`)
}
