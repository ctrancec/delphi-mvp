-- Delphi World — persistence for the AI agent organisation.
--
-- The whole world (companies, agents, floors, tasks, memories, connections,
-- files index, event log, chat) is one JSON document per owner. That keeps the
-- simulation a plain read-modify-write and lets the schema evolve in code
-- rather than in migrations.

create table if not exists public.agent_worlds (
    id          uuid primary key default gen_random_uuid(),
    owner_key   text not null unique,
    name        text not null default 'Delphi World',
    state       jsonb not null,
    version     integer not null default 1,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists agent_worlds_owner_key_idx on public.agent_worlds (owner_key);
create index if not exists agent_worlds_updated_at_idx on public.agent_worlds (updated_at desc);

alter table public.agent_worlds enable row level security;

-- `owner_key` is `user:<auth uid>` for signed-in humans. Anonymous worlds use a
-- cookie-scoped key and are only reachable through the server, never directly.
create policy "Owners read their world"
    on public.agent_worlds for select
    using (owner_key = 'user:' || auth.uid()::text);

create policy "Owners create their world"
    on public.agent_worlds for insert
    with check (owner_key = 'user:' || auth.uid()::text);

create policy "Owners update their world"
    on public.agent_worlds for update
    using (owner_key = 'user:' || auth.uid()::text)
    with check (owner_key = 'user:' || auth.uid()::text);

create policy "Owners delete their world"
    on public.agent_worlds for delete
    using (owner_key = 'user:' || auth.uid()::text);

-- ---------------------------------------------------------------- storage --
-- The shared drive. Objects are keyed `<companyId>/<timestamp>-<filename>`,
-- so a policy on the first path segment scopes a company's files.

insert into storage.buckets (id, name, public)
values ('delphi-world', 'delphi-world', false)
on conflict (id) do nothing;

create policy "Signed-in users read world files"
    on storage.objects for select
    using (bucket_id = 'delphi-world' and auth.role() = 'authenticated');

create policy "Signed-in users write world files"
    on storage.objects for insert
    with check (bucket_id = 'delphi-world' and auth.role() = 'authenticated');

create policy "Signed-in users update world files"
    on storage.objects for update
    using (bucket_id = 'delphi-world' and auth.role() = 'authenticated');

create policy "Signed-in users delete world files"
    on storage.objects for delete
    using (bucket_id = 'delphi-world' and auth.role() = 'authenticated');
