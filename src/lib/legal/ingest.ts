/**
 * Fetching and chunking the reference library.
 *
 * Polite by construction: one pass, one request per document, bounded
 * concurrency, an honest user agent, and a document that is still fresh is not
 * re-fetched at all. Nothing is scraped around a paywall or a robots rule —
 * every source here publishes the text to be read.
 *
 * Chunking is by section rather than by character count wherever the document
 * gives us headings, because a citation has to name something a person can
 * find. "§ 107(1)" is a citation; "characters 4000-5000" is not.
 */

import { createHash } from 'node:crypto';
import { LEGAL_SOURCES, isStale, type LegalSource } from './sources';
import type { Db } from '@/lib/delphi/db';

const USER_AGENT = 'Delphi/1.0 (+https://delphi-mvp.vercel.app; legal reference fetcher)';
const FETCH_TIMEOUT_MS = 20_000;

/** Chunks below this are fragments; above it, a citation stops being specific. */
const MIN_CHUNK = 200;
const MAX_CHUNK = 4_000;

/**
 * Named entities worth decoding by hand.
 *
 * `&sect;` is the one that matters most: it *is* the section symbol the
 * chunker keys on, so leaving it encoded silently costs every section label in
 * a document. The Canadian Copyright Act chunked into 93 pieces with zero
 * labels until this was fixed.
 */
const ENTITIES: Record<string, string> = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    sect: '§', para: '¶', mdash: '—', ndash: '–', hellip: '…',
    lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D',
    eacute: 'é', egrave: 'è', ccedil: 'ç', agrave: 'à', uuml: 'ü', ouml: 'ö',
    copy: '©', reg: '®', deg: '°', middot: '·', bull: '•',
};

export function decodeEntities(text: string): string {
    return text
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&([a-zA-Z]+);/g, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

/**
 * HTML to readable text.
 *
 * Deliberately small rather than a parser dependency: these documents are
 * legislation and regulator pages, which are structurally simple, and the
 * failure mode of over-stripping (losing a heading) is far less damaging than
 * pulling a parser into the serverless bundle for fourteen documents.
 */
export function htmlToText(html: string): string {
    return (
        decodeEntities(
            html
                // Everything that is not prose, before tags are stripped.
                .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
                .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
                .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
                // Site chrome. Government and platform pages wrap the actual
                // text in navigation that would otherwise become the first
                // chunk — which is then what a citation points at.
                .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
                .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
                .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
                .replace(/<!--[\s\S]*?-->/g, ' ')
                // Headings and block ends become line breaks, so section
                // structure survives into the text and can be chunked on.
                .replace(/<\/(h[1-6]|p|div|li|tr|section|article)>/gi, '\n')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]+>/g, ' ')
        )
            // After decoding, because a decoded &nbsp; is whitespace that
            // should collapse with the rest.
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n\s*\n\s*\n+/g, '\n\n')
            .trim()
    );
}

export interface Chunk {
    section: string | null;
    ordinal: number;
    text: string;
}

/**
 * Split on section markers where the document has them, fall back to
 * paragraphs where it does not.
 *
 * The section label is what a finding will cite, so it is carried forward even
 * when the chunk itself gets split for length.
 */
/**
 * What the start of a provision looks like, across the drafting conventions in
 * this library.
 *
 * US federal material uses `§ 107`. Canadian legislation uses a bare number —
 * `2.1 (1) A compilation containing...` — with no symbol at all, which is why
 * the Canadian Copyright Act produced ninety-two chunks and zero citable
 * labels until this was widened. UK and EU material tends toward
 * `Section 17` or `Article 5`.
 *
 * The leading number is capped at four characters so a year opening a sentence
 * does not read as a new provision.
 */
const SECTION_PATTERNS = [
    /^\s*§+\s*\d+[A-Za-z0-9.\-()]*/,
    /^\s*(?:Section|Article|Part|Clause|Schedule)\s+\d+[A-Za-z0-9.\-()]*/i,
    /^\s*\d{1,4}(?:\.\d{1,3})?\s*(?:\(\d+\))?\s+[A-Z(]/,
];

function startsProvision(line: string): boolean {
    return SECTION_PATTERNS.some((re) => re.test(line));
}

export function chunkLegalText(text: string): Chunk[] {

    const lines = text.split('\n');
    const blocks: { section: string | null; lines: string[] }[] = [];
    let current: { section: string | null; lines: string[] } = { section: null, lines: [] };

    for (const line of lines) {
        if (startsProvision(line) && current.lines.join(' ').trim().length > MIN_CHUNK) {
            blocks.push(current);
            current = { section: line.trim().slice(0, 120), lines: [line] };
        } else {
            if (current.section === null && startsProvision(line)) {
                current.section = line.trim().slice(0, 120);
            }
            current.lines.push(line);
        }
    }
    if (current.lines.length) blocks.push(current);

    const chunks: Chunk[] = [];
    let ordinal = 0;

    for (const block of blocks) {
        const body = block.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        if (body.length < MIN_CHUNK) continue;

        if (body.length <= MAX_CHUNK) {
            chunks.push({ section: block.section, ordinal: ordinal++, text: body });
            continue;
        }

        // Too long to cite usefully. Split on paragraphs, keeping the section
        // label so every piece still points somewhere findable.
        let buffer = '';
        for (const para of body.split(/\n\n+/)) {
            if (buffer.length + para.length > MAX_CHUNK && buffer.length >= MIN_CHUNK) {
                chunks.push({ section: block.section, ordinal: ordinal++, text: buffer.trim() });
                buffer = '';
            }
            buffer += (buffer ? '\n\n' : '') + para;
        }
        if (buffer.trim().length >= MIN_CHUNK) {
            chunks.push({ section: block.section, ordinal: ordinal++, text: buffer.trim() });
        }
    }

    return chunks;
}

export interface IngestOneResult {
    title: string;
    status: 'stored' | 'unchanged' | 'fresh' | 'failed';
    chunks: number;
    error?: string;
}

async function fetchDocument(source: LegalSource): Promise<string> {
    const res = await fetch(source.url, {
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html, application/xhtml+xml, application/xml, application/json;q=0.9, */*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const body = await res.text();
    const text = /^\s*[[{]/.test(body) ? htmlToText(JSON.stringify(JSON.parse(body))) : htmlToText(body);

    if (text.length < 500) throw new Error(`Only ${text.length} characters of text extracted.`);
    return text;
}

export async function ingestLegalSource(
    db: Db,
    workspaceId: string,
    source: LegalSource,
    opts: { force?: boolean } = {}
): Promise<IngestOneResult> {
    try {
        const { data: existing } = await db
            .from('delphi_legal_documents')
            .select('id, checksum, retrieved_at')
            .eq('workspace_id', workspaceId)
            .eq('source_url', source.url)
            .maybeSingle();

        // A document still inside its refresh window is not re-fetched. Stale
        // law is worse than no law, but re-reading fresh law is just traffic.
        if (existing && !opts.force && !isStale(existing.retrieved_at as string, source.refreshDays)) {
            return { title: source.title, status: 'fresh', chunks: 0 };
        }

        const text = await fetchDocument(source);
        const checksum = createHash('sha256').update(text).digest('hex').slice(0, 32);

        if (existing && existing.checksum === checksum) {
            // Unchanged, but now re-verified — the age shown beside a citation
            // should reflect when we last confirmed it, not when we first read it.
            await db
                .from('delphi_legal_documents')
                .update({ retrieved_at: new Date().toISOString() })
                .eq('id', existing.id);
            return { title: source.title, status: 'unchanged', chunks: 0 };
        }

        const { data: doc, error: docErr } = await db
            .from('delphi_legal_documents')
            .upsert(
                {
                    workspace_id: workspaceId,
                    title: source.title,
                    jurisdiction: source.jurisdiction,
                    category: source.category,
                    source_url: source.url,
                    licence: source.licence,
                    refresh_days: source.refreshDays,
                    checksum,
                    retrieved_at: new Date().toISOString(),
                },
                { onConflict: 'workspace_id,source_url' }
            )
            .select('id')
            .single();

        if (docErr) throw new Error(docErr.message);

        const chunks = chunkLegalText(text);
        if (chunks.length === 0) throw new Error('Fetched, but nothing chunked out of it.');

        // Replace wholesale: a changed document with stale chunks beside fresh
        // ones would let the board cite a clause that no longer exists.
        await db.from('delphi_legal_chunks').delete().eq('document_id', doc.id);

        for (let i = 0; i < chunks.length; i += 100) {
            const { error } = await db.from('delphi_legal_chunks').insert(
                chunks.slice(i, i + 100).map((c) => ({
                    workspace_id: workspaceId,
                    document_id: doc.id,
                    section: c.section,
                    ordinal: c.ordinal,
                    text: c.text,
                }))
            );
            if (error) throw new Error(error.message);
        }

        return { title: source.title, status: 'stored', chunks: chunks.length };
    } catch (err) {
        return {
            title: source.title,
            status: 'failed',
            chunks: 0,
            error: (err as Error).message.slice(0, 200),
        };
    }
}

export interface LibraryIngestResult {
    results: IngestOneResult[];
    stored: number;
    failed: number;
    totalChunks: number;
}

export async function ingestLegalLibrary(
    db: Db,
    workspaceId: string,
    opts: { force?: boolean; deadline?: number } = {}
): Promise<LibraryIngestResult> {
    const results: IngestOneResult[] = [];
    const CONCURRENCY = 3;

    for (let i = 0; i < LEGAL_SOURCES.length; i += CONCURRENCY) {
        if (opts.deadline && Date.now() > opts.deadline) break;
        const batch = LEGAL_SOURCES.slice(i, i + CONCURRENCY);
        results.push(
            ...(await Promise.all(batch.map((s) => ingestLegalSource(db, workspaceId, s, opts))))
        );
    }

    return {
        results,
        stored: results.filter((r) => r.status === 'stored').length,
        failed: results.filter((r) => r.status === 'failed').length,
        totalChunks: results.reduce((sum, r) => sum + r.chunks, 0),
    };
}
