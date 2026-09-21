/**
 * Talking to Delphi.
 *
 * The conversation persists across sessions, because a CEO you have to
 * re-brief every time you open the app is not one you would keep.
 */

import { MessageSquare } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { CeoChat, type ChatMessage } from '@/components/delphi/ceo-chat';
import { bootstrapDelphi } from '@/lib/delphi/bootstrap';
import { getOrCreateChatThread, loadChatHistory } from '@/lib/delphi/chat-store';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
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
                    <MessageSquare className="h-6 w-6" /> Delphi
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Your CEO. It can read everything and change most things from here — but it cannot
                    approve its own plans or anything waiting in your queue.
                </p>
            </div>
            <CeoChat initial={history} />
        </div>
    );
}
