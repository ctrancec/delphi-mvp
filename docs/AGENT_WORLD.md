# Delphi World

A persistent, real-time agent organisation you run as the **C.H.O. — Chief Human
Officer**. You talk to one agent, the CEO. The CEO founds companies for your
projects, hires the people each one needs, splits the work into tasks and
delegates it. All of it is rendered as a pixel-art office you can watch: agents
walk to desks, think, talk to each other, and the floor grows a new row of desks
as the team does.

Open it at **`/world`**.

---

## What is actually real

| Piece | Status |
|---|---|
| Persistent world across sessions | Real — Supabase, or a JSON file when Supabase isn't configured |
| Long-term memory (world / company / agent scopes) | Real — keyword-scored retrieval, pruned by importance |
| CEO chat, company creation, hiring, task graph | Real |
| Agents reasoning and choosing what to do | Real **when `ANTHROPIC_API_KEY` is set** |
| Web search, code execution | Real — Anthropic server tools, gated by role |
| File storage | Real — Google Drive, Supabase Storage, or local disk |
| Pixel-art rendering, pathfinding, floor growth | Real |
| Agent turns without an API key | **Scripted.** The world moves, but nothing is reasoned about |

The header badge says which mode you're in. Simulation mode exists so you can
see every moving part before spending a token — it is not a fake of the real
thing and it says so in every message it writes.

---

## Running it

```bash
npm install
cp .env.example .env.local     # add ANTHROPIC_API_KEY
npm run dev                    # → http://localhost:3000/world
```

With no configuration at all the world still runs: state lands in
`.delphi/world.json`, files in `.delphi/files/`, and agents follow the scripted
plan.

### Persistence

Set `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` and apply
`supabase/migrations/20260920000000_agent_world.sql`. The whole world is one
`jsonb` document per owner in `agent_worlds`, protected by RLS on
`owner_key = 'user:' || auth.uid()`.

Signed-in users get a world keyed to their Supabase user id. Everyone else gets
one keyed to a long-lived `delphi_world_owner` cookie, so a world survives a
browser restart without an account.

### Storage

`DELPHI_STORAGE_PROVIDER` picks the backing store; leave it unset and the app
uses whichever is configured, falling back to local disk.

- **Google Drive** — `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
  `GOOGLE_DRIVE_REFRESH_TOKEN` (scope `drive.file`), optional
  `GOOGLE_DRIVE_ROOT_FOLDER_ID`. Files land in per-company subfolders of a Drive
  folder you own and can open outside this app.
- **Supabase Storage** — bucket `delphi-world` (the migration creates it), keys
  are `<companyId>/<timestamp>-<name>`, reads go through signed URLs.
- **Local disk** — `.delphi/files/`. Development only.

Adding a fourth (S3, R2, whatever) means implementing `StorageProvider` in
`src/lib/world/storage/` and registering it — nothing else changes.

---

## How a turn works

1. The engine picks who gets a turn (`selectCandidates` in `engine.ts`):
   unread messages first, then active tasks by priority, then idle agents with a
   backlog. Anyone mid-walk is skipped until they arrive.
2. `buildSystemPrompt` assembles who they are, the full org chart **with agent
   ids** (so delegation is possible), their board, their connections, their
   drive and what they remember.
3. The turn runs against Claude with adaptive thinking and the tool surface for
   that role. Every tool call is applied to the world document immediately, so
   an agent that hires someone can assign them work in the same turn.
4. The agent's final message goes into the activity log; `update_task`
   determines whether the work is actually done.

### Two clocks

`stepWorld` is cheap — movement, bubbles, ambient wandering — and runs a few
times a second so the office looks alive. `runAgentTurns` calls the model and
runs on a slower cadence (every ~7s by default), capped by
`maxTurnsPerTick` and a daily turn budget you can see and change in the header.

---

## Roles and capabilities

Defined in `src/lib/world/roles.ts`.

| Role | Model | Capability | Can hire | Can found companies |
|---|---|---|---|---|
| CEO | Opus 5 | web search | ✓ | ✓ |
| Manager | Opus 5 | web search | ✓ | — |
| Engineer | Sonnet 5 | code execution | — | — |
| Researcher | Sonnet 5 | web search | — | — |
| Analyst | Sonnet 5 | code execution | — | — |
| Designer / Ops | Sonnet 5 | — | — | — |
| Intern | Haiku 4.5 | — | — | — |

An agent gets **search or code execution, never both**: the current web-search
tool filters results inside its own code-execution environment, and declaring a
second one in the same request confuses the model.

---

## Connections

Every new project gets its own wiring. Agents can *ask* for a connection with
`request_connection` — the request lands in your chat and on the project's
Connections panel — but **only you can connect one**. An agent that needs
something it does not have is expected to mark its task blocked and say exactly
what is missing, not to pretend.

Secrets never enter the world document. You record the **name of the environment
variable** that holds a credential; the value stays in your deployment
environment. That means the world is safe to export, sync and read.

`src/lib/world/connections.ts` holds the catalogue the UI offers (GitHub,
Postgres, Supabase, Drive, Stripe, Slack, Gmail, Anthropic). Add to it freely.

---

## Cost control

- `maxTurnsPerTick` — how many agents may think per work tick (default 2).
- `dailyTurnBudget` — hard stop for the day (default 400 turns); the header
  shows what you've used.
- `DELPHI_MAX_TASK_TURNS` — a task that runs this long is auto-blocked rather
  than looping.
- `DELPHI_MAX_AGENTS` / `DELPHI_MAX_COMPANIES` — headcount and project ceilings.
- Pause the whole world from the header.

Interns run at `effort: low`; executives at `high`. System prompts are cached
(`cache_control: ephemeral`), so repeated turns for the same agent re-read the
org chart cheaply.

---

## Layout

```
src/lib/world/
  types.ts         domain model (the shape of a world)
  seed.ts          a new world: HQ floor + CEO
  office.ts        floor generation, desk growth, BFS pathfinding
  roles.ts         role → model, capability, hiring rights
  memory.ts        scoped long-term memory, scoring and pruning
  actions.ts       every mutation the world allows
  agent.ts         prompt assembly + the CEO and worker turns
  engine.ts        the two clocks and turn scheduling
  connections.ts   catalogue of integrations
  llm/             Claude turn loop + the scripted fallback
  tools/           agent tool schemas and their executor
  storage/         Drive / Supabase / disk providers
  store/           world persistence (Supabase or JSON file)
src/app/api/world/ state · tick · chat · control · connections · files
src/app/world/     the page
src/components/world/  canvas renderer, chat, org, board, connections, drive
```

---

## Extending it

**A new tool.** Add a schema to `tools/definitions.ts`, a case to
`tools/execute.ts`, and decide in `toolsForAgent` who gets it.

**A new role.** Add it to `ROLES` in `roles.ts`. Model, capability, hiring
rights and sprite colours all come from there.

**A new floor feature.** Add a `TileKind`, place it in `office.ts`'s `layout()`,
draw it in `world-canvas.tsx`'s `drawTile`. Walkability is one set in
`types.ts`.

**Scheduled autonomy.** The world only advances while a browser has `/world`
open. To have it run unattended, call `POST /api/world/tick` with
`{"work": true}` from a cron job.

---

## Known limits

- The world is one JSON document. That is the right trade at this size — a few
  dozen agents — and the wrong one at a few thousand. Events, chat and memories
  are capped and pruned so it cannot grow without bound.
- Memory retrieval is keyword overlap, not embeddings. Swap `score()` in
  `memory.ts` when a world outgrows it.
- Agents on different floors can message each other but cannot walk to each
  other; there is no lift.
- The tick loop is driven by the open browser tab, not a server process.
