/**
 * JSON extraction and repair for LLM output.
 *
 * Gemini's `responseSchema` guarantees syntactically valid JSON but not a
 * semantically correct shape, and Perplexity's sonar models return prose-wrapped
 * JSON with reasoning traces. Both need the same ladder:
 *
 *   1. parse as-is
 *   2. strip reasoning tags / code fences, parse again
 *   3. extract the outermost balanced {...} or [...], parse that
 *
 * Callers that still fail go on to a single model-side repair attempt, then fail
 * the task. Never silently substitute an empty object — a task that produced
 * nothing usable must be visible as failed.
 */

export class JsonExtractionError extends Error {
    readonly raw: string;

    constructor(message: string, raw: string) {
        super(message);
        this.name = 'JsonExtractionError';
        this.raw = raw;
    }
}

/** Remove `<think>` blocks (sonar-reasoning*) and markdown code fences. */
function stripWrappers(text: string): string {
    return text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/```(?:json|JSON)?\s*/g, '')
        .replace(/```/g, '')
        .trim();
}

/**
 * Find the outermost balanced JSON value, respecting strings and escapes.
 *
 * A naive /\{[\s\S]*\}/ grabs from the first brace to the last one anywhere in
 * the response, which swallows trailing commentary and breaks whenever the model
 * emits two objects. This walks the text and stops at the true closing bracket.
 */
function extractBalanced(text: string): string | null {
    const startIdx = text.search(/[{[]/);
    if (startIdx === -1) return null;

    const open = text[startIdx];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIdx; i < text.length; i++) {
        const ch = text[i];

        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            if (inString) escaped = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;

        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return text.slice(startIdx, i + 1);
        }
    }

    return null;
}

/**
 * Best-effort parse of a JSON value out of raw model output.
 * Throws JsonExtractionError when nothing parseable is present.
 */
export function extractJson<T = unknown>(raw: string): T {
    if (!raw || !raw.trim()) {
        throw new JsonExtractionError('Model returned empty output', raw ?? '');
    }

    const candidates = [raw.trim(), stripWrappers(raw)];
    const balanced = extractBalanced(stripWrappers(raw));
    if (balanced) candidates.push(balanced);

    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            return JSON.parse(candidate) as T;
        } catch {
            // try the next, more aggressive, candidate
        }
    }

    throw new JsonExtractionError('No parseable JSON found in model output', raw);
}

/** Non-throwing variant for callers that have their own fallback. */
export function tryExtractJson<T = unknown>(raw: string): T | null {
    try {
        return extractJson<T>(raw);
    } catch {
        return null;
    }
}
