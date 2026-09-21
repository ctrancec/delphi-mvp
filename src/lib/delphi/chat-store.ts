/**
 * Where the conversation with Delphi lives.
 *
 * One thread per workspace, reusing the same tables the boardroom uses — a
 * conversation with the CEO is the same kind of record as a deliberation with
 * the board, and both should be searchable months later for the same reason.
 */

import type { Db } from './db';
import type { ChatTurn } from './chat';

const THREAD_TITLE = 'Conversation with Delphi';

export async function getOrCreateChatThread(db: Db, workspaceId: string): Promise<string | null> {
    const { data: existing } = await db
        .from('delphi_threads')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('title', THREAD_TITLE)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (existing) return existing.id as string;

    const { data, error } = await db
        .from('delphi_threads')
        .insert({ workspace_id: workspaceId, title: THREAD_TITLE, status: 'open' })
        .select('id')
        .single();

    if (error) {
        console.error('[delphi] could not open the chat thread:', error.message);
        return null;
    }
    return data.id as string;
}

export async function loadChatHistory(db: Db, threadId: string, limit = 40): Promise<ChatTurn[]> {
    const { data } = await db
        .from('delphi_messages')
        .select('role, content, created_at')
        .eq('thread_id', threadId)
        .in('role', ['cho', 'ceo'])
        .order('created_at', { ascending: true })
        .limit(limit);

    return (data ?? []).map((m) => ({
        role: m.role as ChatTurn['role'],
        content: m.content as string,
    }));
}
