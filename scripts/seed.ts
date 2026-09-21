/**
 * Seed the agent roster into the live database.
 *
 *   npm run delphi:seed              # seeds the first workspace found
 *   npm run delphi:seed -- <ws-uuid> # seeds a specific workspace
 *
 * Idempotent: re-running adds agents introduced since the last seed without
 * touching existing personas or their accumulated track records.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY, because seeding acts as the system rather
 * than as a signed-in user and so has no session for RLS to key off.
 */

import { createServiceClient } from '../src/lib/supabase/service';
import { seedChannels, seedRoster, listAgents, listBoardAgents } from '../src/lib/delphi/db';
import { ALL_SEED_AGENTS } from '../src/lib/delphi/roster';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

async function main() {
    const db = createServiceClient();
    if (!db) {
        throw new Error(
            'Supabase service client unavailable. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.'
        );
    }

    let workspaceId = process.argv[2];

    if (!workspaceId) {
        // No workspace given — use the oldest one, which is the one the CHO
        // created via bootstrap_workspace().
        const { data, error } = await db
            .from('workspaces')
            .select('id, name')
            .order('created_at', { ascending: true })
            .limit(1);

        if (error) throw new Error(`Could not list workspaces: ${error.message}`);
        if (!data?.length) {
            throw new Error(
                'No workspaces exist yet. Sign in to the app and run:  select public.bootstrap_workspace(\'Delphi\');'
            );
        }

        workspaceId = data[0].id;
        console.log(`${DIM}Using workspace "${data[0].name}" (${workspaceId})${RESET}`);
    }

    // Channels first — seedRoster binds agents to channel ids at insert time.
    const ch = await seedChannels(db, workspaceId!);
    console.log(`\n${BOLD}Channels${RESET}`);
    console.log(`  ${GREEN}+${RESET} connected ${ch.inserted}${ch.skipped ? `  ${DIM}(${ch.skipped} already present)${RESET}` : ''}`);
    if (ch.inserted === 0 && ch.skipped === 0) {
        console.log(`  ${RED}none configured${RESET} ${DIM}— agents will run with no tools. Check your API keys.${RESET}`);
    }

    console.log(`\n${BOLD}Seeding roster${RESET} ${DIM}— ${ALL_SEED_AGENTS.length} agents defined${RESET}\n`);

    const { inserted, skipped } = await seedRoster(db, workspaceId!);

    console.log(`  ${GREEN}+${RESET} inserted ${inserted}`);
    if (skipped) console.log(`  ${DIM}·${RESET} already present ${skipped}`);

    const workers = await listAgents(db, workspaceId!);
    const board = await listBoardAgents(db, workspaceId!);

    console.log(`\n${BOLD}Workers${RESET} ${DIM}(${workers.length})${RESET}`);
    for (const a of workers) {
        console.log(
            `  ${CYAN}${a.name.padEnd(18)}${RESET} ${a.title.padEnd(30)} ${DIM}tier ${a.costTier}  ${a.skills.slice(0, 3).join(', ')}${RESET}`
        );
    }

    console.log(`\n${BOLD}L.L.R. Board${RESET} ${DIM}(${board.length})${RESET}`);
    for (const a of board) {
        console.log(`  ${CYAN}${a.name.padEnd(18)}${RESET} ${a.title}`);
    }

    // The board must exist or review rounds cannot run at all.
    if (board.length < 3) {
        console.log(
            `\n${RED}⚠ Expected 3 board agents, found ${board.length}.${RESET} Review rounds will fail.`
        );
        process.exit(1);
    }

    console.log(`\n${GREEN}✓${RESET} Roster ready. ${DIM}Create a department to put them to work.${RESET}\n`);
}

main().catch((err) => {
    console.error(`\n${RED}✗ ${err.message}${RESET}\n`);
    process.exit(1);
});
