/**
 * Connection catalogue.
 *
 * Every project needs its own wiring — a repo, a payment processor, a
 * database, a drive folder. Agents can *ask* for any of these; only the CHO can
 * connect one. The catalogue exists so the UI can offer sensible options and so
 * a request from an agent lands with the right field names attached.
 */

export interface CatalogEntry {
    provider: string
    label: string
    category: 'code' | 'data' | 'money' | 'comms' | 'storage' | 'ai' | 'other'
    fields: string[]
    hint: string
}

export const CONNECTION_CATALOG: CatalogEntry[] = [
    {
        provider: 'github',
        label: 'GitHub',
        category: 'code',
        fields: ['GITHUB_TOKEN'],
        hint: 'Personal access token with repo scope. Lets the team read and open pull requests.',
    },
    {
        provider: 'postgres',
        label: 'Postgres database',
        category: 'data',
        fields: ['DATABASE_URL'],
        hint: 'Connection string. Gives analysts something real to query.',
    },
    {
        provider: 'supabase',
        label: 'Supabase project',
        category: 'data',
        fields: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
        hint: 'Backs both the world state and the shared drive.',
    },
    {
        provider: 'google-drive',
        label: 'Google Drive folder',
        category: 'storage',
        fields: ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN'],
        hint: 'Files land in a folder you already own and can open outside this app.',
    },
    {
        provider: 'stripe',
        label: 'Stripe',
        category: 'money',
        fields: ['STRIPE_SECRET_KEY'],
        hint: 'Revenue, payouts and subscription data.',
    },
    {
        provider: 'slack',
        label: 'Slack',
        category: 'comms',
        fields: ['SLACK_BOT_TOKEN'],
        hint: 'Lets a company post updates where your humans already are.',
    },
    {
        provider: 'gmail',
        label: 'Gmail',
        category: 'comms',
        fields: ['GOOGLE_OAUTH_REFRESH_TOKEN'],
        hint: 'Read and draft mail for the project.',
    },
    {
        provider: 'anthropic',
        label: 'Anthropic API',
        category: 'ai',
        fields: ['ANTHROPIC_API_KEY'],
        hint: 'Required for agents to actually think. Without it the world runs scripted.',
    },
]

export function catalogEntry(provider: string): CatalogEntry | null {
    return CONNECTION_CATALOG.find((c) => c.provider === provider) ?? null
}

/**
 * The connections a brand new company starts out needing. Kept deliberately
 * small: a project's real integrations are discovered by the team, not guessed
 * here — the CEO raises the rest through `request_connection`.
 */
export function starterConnections(): { provider: string; label: string; reason: string; fields: string[] }[] {
    return [
        {
            provider: 'shared-drive',
            label: 'Project drive',
            reason: 'Where this project keeps files the team and the CHO both need.',
            fields: [],
        },
    ]
}
