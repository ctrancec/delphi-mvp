import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { TOOL_REGISTRY, UserRole } from '@/lib/types/tool-registry'
import { readAnonEnv } from './env'
import { canSkipRefresh, readSessionCookie, storageKeyFor } from './session-cookie'

/**
 * Session refresh and route guarding, on every request.
 *
 * `getUser()` is a network round trip to Supabase's auth server by design — it
 * revalidates the token rather than trusting the cookie. So it is the most
 * expensive thing on this path and it runs before anything is rendered. This
 * used to call it **twice** on every request (once to resolve a role for RBAC,
 * once to decide the login redirect), which meant every page load paid two
 * serial auth round trips before the first query.
 *
 * Now it is made at most once, and usually not at all: the only reason this
 * function needs the auth server is to refresh a token that is running out,
 * and the cookie says when that is. A session with fifty minutes left is left
 * alone.
 *
 * Skipping it is safe because this is not where authorization happens. The
 * dashboard layout calls `getUser()` for real and redirects when it comes back
 * empty, and every query runs under RLS against a token Postgres verifies
 * itself. What this decides is only whether someone gets that far before being
 * sent to the login page.
 */
export async function updateSession(request: NextRequest) {
    let response = NextResponse.next({
        request: {
            headers: request.headers,
        },
    })

    // Validated rather than read raw: a key carrying characters that cannot go
    // in an HTTP header throws from inside fetch, and middleware runs on every
    // request, so that failure would take down the whole site rather than one
    // route.
    const env = readAnonEnv();
    if (!env) return response;

    const supabase = createServerClient(env.url, env.key, {
        cookies: {
            getAll() {
                return request.cookies.getAll()
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value }) => {
                    request.cookies.set(name, value)
                })
                response = NextResponse.next({ request })
                cookiesToSet.forEach(({ name, value, options }) =>
                    response.cookies.set(name, value, options)
                )
            },
        },
    })

    // What the browser claims, read locally. Never trusted for authorization —
    // only to work out whether a refresh is due. See session-cookie.ts.
    const storageKey = storageKeyFor(env.url)
    const claimed = storageKey
        ? readSessionCookie(storageKey, (name) => request.cookies.get(name)?.value)
        : null

    // One verified call, at most, per request, and only when something needs
    // the answer for real.
    let resolved: { user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] } | null = null
    const verifiedUser = async () => {
        if (!resolved) {
            const { data } = await supabase.auth.getUser()
            resolved = { user: data.user }
        }
        return resolved.user
    }

    // --- Role Based Access Control (RBAC) ---
    const path = request.nextUrl.pathname

    // The tool whose href owns this path, if any.
    const protectedToolId = Object.keys(TOOL_REGISTRY).find(key => {
        const tool = TOOL_REGISTRY[key as keyof typeof TOOL_REGISTRY]
        return path === tool.href || path.startsWith(`${tool.href}/`)
    })

    const tool = protectedToolId
        ? TOOL_REGISTRY[protectedToolId as keyof typeof TOOL_REGISTRY]
        : null

    // Only look up a role when there is a rule to apply to it. A tool with no
    // `allowedRoles` permits everyone, so resolving who you are just to grant
    // what was never in doubt is a round trip spent on nothing.
    if (tool?.allowedRoles) {
        // Priority: mock cookie (dev/demo) > Supabase session (prod).
        let userRole: UserRole | undefined = request.cookies.get('delphi_user_role')?.value as
            | UserRole
            | undefined

        if (!userRole) {
            // Verified, not claimed: this one is an authorization decision, so
            // it is worth the round trip on the rare path that reaches it.
            if (await verifiedUser()) userRole = 'owner'
        }

        if (userRole && !tool.allowedRoles.includes(userRole)) {
            console.log(`[Middleware] Access Denied: Role '${userRole}' tried to access '${path}'`)
            const url = request.nextUrl.clone()
            url.pathname = '/dashboard'
            return NextResponse.redirect(url)
        }
    }
    // --- End RBAC ---

    // Signed-out visitors never reach the dashboard.
    //
    // A cookie with plenty of life left answers this without asking Supabase:
    // there is no refresh to do, and the layout verifies the token for real
    // before it renders anything. Everything else — no cookie, an unreadable
    // one, one near expiry — goes to the auth server, which is what refreshes
    // a session that is running out.
    const signedIn = canSkipRefresh(claimed) ? true : Boolean(await verifiedUser())

    if (
        !signedIn &&
        !request.nextUrl.pathname.startsWith('/login') &&
        !request.nextUrl.pathname.startsWith('/auth') &&
        request.nextUrl.pathname.startsWith('/dashboard')
    ) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    return response
}
