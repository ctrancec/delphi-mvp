/**
 * Email, through Resend's REST API.
 *
 * One call, no package. The free tier sends a few thousand a month, which
 * is a few thousand more than a CHO needs. The sender address is Resend's
 * own until a domain is verified there, in which case it only delivers to
 * the account that owns the key — which, for one person's dashboard, is
 * exactly right. Never throws: a refusal is a result.
 */

const API = 'https://api.resend.com/emails';

const key = () => (process.env.RESEND_API_KEY ?? '').trim();
const from = () => (process.env.NOTIFY_FROM ?? '').trim() || 'Tempest <onboarding@resend.dev>';

export function isEmailConfigured(): boolean {
    return key().length > 0;
}

export interface EmailResult {
    ok: boolean;
    status: number;
    detail?: string;
}

export async function sendEmail(to: string, subject: string, text: string, html: string): Promise<EmailResult> {
    if (!isEmailConfigured()) return { ok: false, status: 0, detail: 'RESEND_API_KEY is not set' };
    try {
        const res = await fetch(API, {
            method: 'POST',
            headers: { authorization: `Bearer ${key()}`, 'content-type': 'application/json' },
            body: JSON.stringify({ from: from(), to: [to], subject, text, html }),
            signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) return { ok: false, status: res.status, detail: (await res.text()).slice(0, 160) };
        return { ok: true, status: res.status };
    } catch (err) {
        return { ok: false, status: 0, detail: (err as Error).message };
    }
}
