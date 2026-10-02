'use client';

/**
 * Who else is in the workspace, and inviting more.
 *
 * An invitation is a link: mint one for a role, hand it over however you
 * like, and whoever opens it signed in joins. Links last seven days and
 * work once. Roles can be changed and people removed from here; the owner
 * is the workspace's and cannot be.
 */

import { useState, useTransition } from 'react';
import { Check, Copy, Link2, Loader2, Trash2, TriangleAlert, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createInviteAction, removeMemberAction, revokeInviteAction, setMemberRoleAction } from '@/app/account/actions';
import { inviteState, type Invite, type Member, type Role } from '@/lib/delphi/members';

const ROLE_WORDS: Record<Role, string> = { owner: 'owner', reviewer: 'reviewer', viewer: 'viewer' };

export function TeamCard({ members, invites: initialInvites, origin, you }: { members: Member[]; invites: Invite[]; origin: string; you: string }) {
    const [invites, setInvites] = useState(initialInvites);
    const [role, setRole] = useState<'reviewer' | 'viewer'>('reviewer');
    const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
    const [copied, setCopied] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    const link = (token: string) => `${origin}/invite/${token}`;
    const copy = async (token: string) => {
        try {
            await navigator.clipboard.writeText(link(token));
            setCopied(token);
            setTimeout(() => setCopied(null), 2000);
        } catch {
            setNote({ ok: false, text: 'Could not copy; select the link and copy it yourself.' });
        }
    };

    const invite = () =>
        startTransition(async () => {
            const res = await createInviteAction(role);
            if (res.ok && res.invite) {
                setInvites([res.invite, ...invites]);
                setNote({ ok: true, text: 'Link made. Copy it and send it to them; it works once, within seven days.' });
            } else setNote({ ok: false, text: res.error ?? 'Could not create the invitation.' });
        });

    const revoke = (id: string) =>
        startTransition(async () => {
            const res = await revokeInviteAction(id);
            if (res.ok) setInvites(invites.map((i) => (i.id === id ? { ...i, revokedAt: new Date().toISOString() } : i)));
            else setNote({ ok: false, text: res.error ?? 'Could not withdraw it.' });
        });

    const open = invites.filter((i) => inviteState(i) === 'open');

    return (
        <div className="space-y-5">
            <ul className="divide-y divide-white/5 text-sm">
                {members.map((m) => (
                    <li key={m.userId} className="flex flex-wrap items-center gap-2 py-2">
                        <span className="min-w-0 flex-1 truncate text-zinc-100">
                            {m.email ?? (m.userId === you ? 'You' : `Member ${m.userId.slice(0, 8)}`)}
                            {m.userId === you && m.email ? <span className="text-muted-foreground"> (you)</span> : null}
                        </span>
                        {m.role === 'owner' ? (
                            <span className="text-xs text-muted-foreground">owner</span>
                        ) : (
                            <>
                                <select
                                    data-ui="input"
                                    value={m.role}
                                    disabled={pending}
                                    onChange={(e) =>
                                        startTransition(async () => {
                                            const res = await setMemberRoleAction(m.userId, e.target.value as 'reviewer' | 'viewer');
                                            setNote({ ok: res.ok, text: res.ok ? 'Role changed.' : (res.error ?? 'Could not change it.') });
                                        })
                                    }
                                    className="h-7 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-white"
                                >
                                    <option value="reviewer">reviewer</option>
                                    <option value="viewer">viewer</option>
                                </select>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={pending}
                                    onClick={() =>
                                        startTransition(async () => {
                                            const res = await removeMemberAction(m.userId);
                                            setNote({ ok: res.ok, text: res.ok ? 'Removed. Refresh to see the list without them.' : (res.error ?? 'Could not remove them.') });
                                        })
                                    }
                                    className="h-7 border-red-400/30 px-2 text-xs text-red-300 hover:bg-red-400/10"
                                    title="Remove from the workspace"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </Button>
                            </>
                        )}
                    </li>
                ))}
            </ul>

            <div className="flex flex-wrap items-center gap-2">
                <select data-ui="input" value={role} onChange={(e) => setRole(e.target.value as 'reviewer' | 'viewer')} className="h-8 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-white">
                    <option value="reviewer">Reviewer: reads everything, posts in threads</option>
                    <option value="viewer">Viewer: reads everything</option>
                </select>
                <Button size="sm" onClick={invite} disabled={pending}>
                    {pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <UserPlus className="mr-2 h-3.5 w-3.5" />}
                    Make an invitation link
                </Button>
            </div>

            {open.length > 0 && (
                <ul className="space-y-2 text-xs">
                    {open.map((i) => (
                        <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2">
                            <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <code className="min-w-0 flex-1 truncate text-zinc-200">{link(i.token)}</code>
                            <span className="text-muted-foreground">{ROLE_WORDS[i.role]}</span>
                            <Button size="sm" variant="outline" onClick={() => copy(i.token)} className="h-7 border-white/10 px-2 text-xs">
                                {copied === i.token ? <Check className="mr-1 h-3 w-3 text-emerald-400" /> : <Copy className="mr-1 h-3 w-3" />}
                                {copied === i.token ? 'Copied' : 'Copy'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => revoke(i.id)} disabled={pending} className="h-7 border-white/10 px-2 text-xs text-muted-foreground">
                                Withdraw
                            </Button>
                        </li>
                    ))}
                </ul>
            )}

            {note && (
                <p className={`flex items-center gap-2 text-sm ${note.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {note.ok ? <Check className="h-4 w-4 shrink-0" /> : <TriangleAlert className="h-4 w-4 shrink-0" />} {note.text}
                </p>
            )}
        </div>
    );
}
