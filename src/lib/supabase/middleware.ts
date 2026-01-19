import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { TOOL_REGISTRY, UserRole } from '@/lib/types/tool-registry'

export async function updateSession(request: NextRequest) {
    let response = NextResponse.next({
        request: {
            headers: request.headers,
        },
    })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // --- Role Based Access Control (RBAC) ---
    // 1. Get the current path
    const path = request.nextUrl.pathname

    // 2. Identify if this path matches a protected tool
    // We search for a tool whose href matches the start of the current path
    const protectedToolId = Object.keys(TOOL_REGISTRY).find(key => {
        const tool = TOOL_REGISTRY[key as keyof typeof TOOL_REGISTRY]
        return path === tool.href || path.startsWith(`${tool.href}/`)
    })

    if (protectedToolId) {
        const tool = TOOL_REGISTRY[protectedToolId as keyof typeof TOOL_REGISTRY]

        // 3. Determine User Role
        // Priority: Mock Cookie (for dev/demo) > Supabase Session (for prod)
        let userRole: UserRole | undefined = undefined

        const roleCookie = request.cookies.get('delphi_user_role')
        if (roleCookie) {
            userRole = roleCookie.value as UserRole
        }

        // Check Supabase if configured (and no override cookie or if cookie is invalid)
        if (supabaseUrl && supabaseAnonKey && !userRole) {
            const supabase = createServerClient(
                supabaseUrl,
                supabaseAnonKey,
                {
                    cookies: {
                        getAll() { return request.cookies.getAll() },
                        setAll(cookiesToSet) {
                            cookiesToSet.forEach(({ name, value, options }) => {
                                request.cookies.set(name, value)
                            })
                            response = NextResponse.next({ request })
                            cookiesToSet.forEach(({ name, value, options }) =>
                                response.cookies.set(name, value, options)
                            )
                        },
                    },
                }
            )
            const { data: { user } } = await supabase.auth.getUser()
            // In a real app, we would fetch the user's role from a 'profiles' table here.
            // For now, if authenticated via Supabase, we default to 'owner' or check metadata.
            if (user) userRole = 'owner'
        }

        // Default to 'owner' if no role found in dev, OR redirect to login if strict
        // For the purpose of this mock-heavy demo, if no role is found, we might assume 'public' or redirect.
        // Let's assume strict: if no role, redirect to login.
        // However, for the initial load of the app without cookies, this might block.
        // We act only if we found a userRole or if we want to enforce login.

        // 4. Check Permissions
        if (userRole && tool.allowedRoles) {
            if (!tool.allowedRoles.includes(userRole)) {
                // Unauthorized
                console.log(`[Middleware] Access Denied: Role '${userRole}' tried to access '${path}'`)
                const url = request.nextUrl.clone()
                url.pathname = '/dashboard' // Send back to main dashboard
                return NextResponse.redirect(url)
            }
        }
    }

    // --- End RBAC ---

    if (!supabaseUrl || !supabaseAnonKey) {
        return response;
    }

    // Existing Supabase Session refresh logic...
    const supabase = createServerClient(
        supabaseUrl,
        supabaseAnonKey,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        request.cookies.set(name, value)
                    })
                    response = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (
        !user &&
        !request.nextUrl.pathname.startsWith('/login') &&
        !request.nextUrl.pathname.startsWith('/auth') &&
        request.nextUrl.pathname.startsWith('/dashboard')
    ) {
        // no user, potentially respond by redirecting the user to the login page
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    return response
}
