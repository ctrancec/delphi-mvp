/**
 * A small in-memory PostgREST for the offline suites.
 *
 * Enough of the query builder for the code under test: filters (dotted ones
 * reach into embeds), ordering on several keys, limits, counts, embeds named
 * in the select (`alias:table(...)`, with `!inner`), inserts that return
 * their row, updates and deletes that return what they touched, unique
 * constraints that fail the way Postgres does, and signed URLs for storage.
 */

import type { Db } from '../src/lib/delphi/db';

export type Row = Record<string, unknown>;

export interface FakeOptions {
    /** Column sets that must be unique per table, when every column is set. */
    unique?: Record<string, string[][]>;
    /** Values a fresh row of a table starts with. */
    defaults?: Record<string, Row>;
    failInserts?: boolean;
    /** Start of the clock that stamps created_at. */
    clock?: number;
}

interface Embed {
    alias: string;
    table: string;
    inner: boolean;
    select: string;
}

/** Split a select list at its top-level commas. */
function topLevel(select: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of select) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) {
            out.push(cur.trim());
            cur = '';
        } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

function embedsOf(select: string): Embed[] {
    const out: Embed[] = [];
    for (const item of topLevel(select)) {
        const m = /^(\w+):(\w+)(!inner)?\s*\(([\s\S]*)\)$/.exec(item);
        if (m) out.push({ alias: m[1], table: m[2], inner: Boolean(m[3]), select: m[4] });
    }
    return out;
}

/** The column an embed follows: `author` is the agent who wrote a message; anything else is `<alias>_id`. */
const fkFor = (alias: string): string => (alias === 'author' ? 'author_agent_id' : `${alias}_id`);

const get = (r: Row, k: string): unknown => k.split('.').reduce<unknown>((v, p) => (v && typeof v === 'object' ? (v as Row)[p] : undefined), r);

export function fakeDb(tables: Record<string, Row[]>, opts: FakeOptions = {}): Db {
    let n = 1;
    let clock = opts.clock ?? Date.parse('2026-10-06T09:00:00Z');

    function withEmbeds(table: string, r: Row, select: string): Row | null {
        const out: Row = { ...r };
        for (const e of embedsOf(select)) {
            const id = r[fkFor(e.alias)];
            const target = (tables[e.table] ?? []).find((x) => x.id === id) ?? null;
            const embedded = target ? withEmbeds(e.table, target, e.select) : null;
            if (e.inner && !embedded) return null;
            out[e.alias] = embedded;
        }
        return out;
    }

    function violates(table: string, row: Row): boolean {
        for (const cols of opts.unique?.[table] ?? []) {
            if (cols.some((c) => row[c] === null || row[c] === undefined)) continue;
            if ((tables[table] ?? []).some((x) => x !== row && cols.every((c) => String(x[c]) === String(row[c])))) return true;
        }
        return false;
    }

    const from = (table: string) => {
        const st = {
            op: 'select' as 'select' | 'insert' | 'update' | 'delete',
            select: '*',
            filters: [] as ((r: Row) => boolean)[],
            payload: null as Row | null,
            orders: [] as { col: string; asc: boolean }[],
            cap: null as number | null,
            head: false,
            count: false,
        };
        const run = (): { data: unknown; error: { code?: string; message: string } | null; count?: number } => {
            const rows = (tables[table] ??= []);
            if (st.op === 'insert') {
                if (opts.failInserts) return { data: null, error: { message: 'insert refused' } };
                clock += 1000;
                const row: Row = { id: `${table}-${n++}`, created_at: new Date(clock).toISOString(), ...(opts.defaults?.[table] ?? {}), ...st.payload };
                if (violates(table, row)) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${table}` } };
                rows.push(row);
                return { data: [withEmbeds(table, row, st.select)], error: null };
            }
            let hit = rows.map((r) => ({ src: r, view: withEmbeds(table, r, st.select) })).filter((x): x is { src: Row; view: Row } => x.view !== null);
            hit = hit.filter((x) => st.filters.every((f) => f(x.view)));
            if (st.op === 'update') {
                for (const x of hit) Object.assign(x.src, st.payload);
                return { data: hit.map((x) => ({ ...x.src })), error: null };
            }
            if (st.op === 'delete') {
                for (const x of hit) rows.splice(rows.indexOf(x.src), 1);
                return { data: hit.map((x) => x.view), error: null };
            }
            let views = hit.map((x) => x.view);
            if (st.orders.length) {
                views = [...views].sort((a, b) => {
                    for (const o of st.orders) {
                        const av = a[o.col];
                        const bv = b[o.col];
                        const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
                        if (c) return o.asc ? c : -c;
                    }
                    return 0;
                });
            }
            if (st.cap !== null) views = views.slice(0, st.cap);
            if (st.count) return { data: st.head ? null : views, error: null, count: hit.length };
            return { data: views, error: null };
        };
        const self: Record<string, unknown> = {
            select: (cols?: string, o?: { count?: string; head?: boolean }) => {
                if (cols) st.select = cols;
                if (o?.count) st.count = true;
                if (o?.head) st.head = true;
                return self;
            },
            eq: (k: string, v: unknown) => (st.filters.push((r) => get(r, k) === v), self),
            neq: (k: string, v: unknown) => (st.filters.push((r) => get(r, k) !== v), self),
            is: (k: string, v: unknown) => (st.filters.push((r) => (get(r, k) ?? null) === v), self),
            not: (k: string, op: string, v: unknown) => (st.filters.push((r) => (op === 'is' ? (get(r, k) ?? null) !== v : get(r, k) !== v)), self),
            in: (k: string, v: unknown[]) => (st.filters.push((r) => v.includes(get(r, k))), self),
            gte: (k: string, v: string | number) => (st.filters.push((r) => (typeof v === 'number' ? Number(get(r, k)) >= v : Date.parse(String(get(r, k))) >= Date.parse(v) || String(get(r, k) ?? '') >= v)), self),
            lte: (k: string, v: string | number) => (st.filters.push((r) => (typeof v === 'number' ? Number(get(r, k)) <= v : Date.parse(String(get(r, k))) <= Date.parse(v))), self),
            lt: (k: string, v: string) => (st.filters.push((r) => Date.parse(String(get(r, k))) < Date.parse(v)), self),
            order: (col: string, o?: { ascending?: boolean }) => (st.orders.push({ col, asc: o?.ascending !== false }), self),
            limit: (k: number) => ((st.cap = k), self),
            insert: (row: Row) => ((st.op = 'insert'), (st.payload = row), self),
            update: (p: Row) => ((st.op = 'update'), (st.payload = p), self),
            delete: () => ((st.op = 'delete'), self),
            maybeSingle: async () => {
                const r = run();
                return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
            },
            single: async () => {
                const r = run();
                return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error };
            },
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
        };
        return self;
    };
    const storage = {
        from: () => ({
            createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `signed:${p}`, error: null })), error: null }),
        }),
    };
    return { from, storage } as unknown as Db;
}
