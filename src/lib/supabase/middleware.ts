import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { TOOL_REGISTRY, UserRole } from '@/lib/types/tool-registry'
import { readAnonEnv } from './env'

/**
 * Session refresh and route guarding, on every request.
 *
 * `getUser()` is a network round trip to Supabase's auth server by design — it
 * revalidates the token rather than trusting the cookie. So it is the most
 * expensive thing on this path and it runs before anything is rendered. This
 * used to call it **twice** on every dashboard request (once to resolve a role
 * for RBAC, once to decide the login redirect), which meant every page load
 * paid two serial auth round trips before the first query. It is now resolved
 * once, lazily, and shared.
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

    // One call, at most, per request — and only once something actually needs
    // the answer. Two callers below want it; neither should pay for it twice.
    let resolved: { user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] } | null = null
    const currentUser = async () => {
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
            // In a real app the role would come from a profiles table.
            if (await currentUser()) userRole = 'owner'
        }

        if (userRole && !tool.allowedRoles.includes(userRole)) {
            console.log(`[Middleware] Access Denied: Role '${userRole}' tried to access '${path}'`)
            const url = request.nextUrl.clone()
            url.pathname = '/dashboard'
            return NextResponse.redirect(url)
        }
    }
    // --- End RBAC ---

    // Signed-out visitors never reach the dashboard. Everywhere else, the call
    // below still runs: it is what refreshes an expiring session, so skipping
    // it on public pages would let a session go stale while someone reads one.
    const user = await currentUser()

    if (
        !user &&
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
