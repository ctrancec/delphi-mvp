/**
 * Talking to Delphi.
 *
 * The conversation persists across sessions, because a CEO you have to
 * re-brief every time you open the app is not one you would keep.
 */

import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { CeoChat, type ChatMessage } from '@/components/delphi/ceo-chat';
import { bootstrapDelphi } from '@/lib/delphi/bootstrap';
import { getOrCreateChatThread, loadChatHistory } from '@/lib/delphi/chat-store';

import { CEO_NAME } from '@/lib/pixel/cast/names';
import { AgentSprite } from '@/components/pixel/agent-sprite';
import { DELPHI_SLUG } from '@/lib/delphi/db';
export const dynamic = 'force-dynamic';

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ ask?: string }> }) {
    // A question carried over from a card in the town, ready to send or to change.
    const ask = ((await searchParams).ask ?? '').slice(0, 500);
    const supabase = await createClient();
    if (!supabase) {
        return (
            <Card className="border-white/10 bg-black/40">
                <CardContent className="py-10 text-center text-muted-foreground">
                    Supabase is not configured.
                </CardContent>
            </Card>
        );
    }

    // Delphi needs its own agent row to speak at all, which provisioning creates.
    const provisioned = await bootstrapDelphi(supabase);

    let history: ChatMessage[] = [];
    if (provisioned) {
        const threadId = await getOrCreateChatThread(supabase, provisioned.workspaceId);
        if (threadId) {
            history = (await loadChatHistory(supabase, threadId)).map((t) => ({
                role: t.role,
                content: t.content,
            }));
        }
    }

    return (
        <div className="mx-auto max-w-3xl">
            <div className="mb-4">
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                    <AgentSprite agent={{ slug: DELPHI_SLUG, name: CEO_NAME }} state="idle" scale={2} /> {CEO_NAME}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Your CEO. It can read everything and change most things from here — but it cannot
                    approve its own plans or anything waiting in your queue.
                </p>
            </div>
            <CeoChat initial={history} draft={ask} />
        </div>
    );
}
