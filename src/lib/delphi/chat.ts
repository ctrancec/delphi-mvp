/**
 * Talking to the CEO.
 *
 * Delphi can read the whole organisation and change quite a lot of it from
 * this conversation — stand up a department, staff it, adjust a budget, pause
 * or stop the system, kick the engine.
 *
 * **What it cannot do is approve anything.** Not its own staffing plan, and
 * certainly not an outward-facing action waiting in the queue. That line is
 * the point of the whole design: the L.L.R. board advises, Delphi recommends,
 * and the CHO is the only thing in the system that consents. A CEO that could
 * approve its own spending is not a CEO with a boss.
 *
 * So the tools below split cleanly. Reads are free. Writes that only change
 * Delphi's own plans, or that *reduce* what the system is doing, are allowed.
 * Anything that commits money or reaches the world is a proposal Delphi hands
 * back for a click.
 */

import { Type, type FunctionDeclaration, type Schema } from '@google/genai';
import { generateWithTools } from '@/lib/llm/gemini';
import { DELPHI_SYSTEM_PROMPT } from './delphi';
import { emitEvent, getSystemMode, setSystemMode, type Db } from './db';
import { formatUsd } from '@/lib/llm/cost';

const MODEL = 'gemini-3.8-flash';

export interface ChatTurn {
    role: 'cho' | 'ceo';
    content: string;
}

export interface ChatResult {
    reply: string;
    /** What Delphi actually did, in the CHO's words, for the activity log. */
    actions: string[];
    costUsd: number;
    model: string;
}

const RESPONSE_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        reply: {
            type: Type.STRING,
            description:
                'Your answer to the CHO. Plain prose, no markdown headers. Be direct and brief — this is a conversation, not a report.',
        },
    },
    required: ['reply'],
};

const TOOLS: FunctionDeclaration[] = [
    {
        name: 'get_status',
        description:
            'The current state of the organisation: departments, projects, what is running, spend against budget, what is waiting on the CHO, and recent activity. Call this before answering anything about how things are going.',
        parameters: { type: Type.OBJECT, properties: {} },
    },
    {
        name: 'list_outputs',
        description: 'Deliverables the agents have produced, newest first, with which agent made each.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                limit: { type: Type.NUMBER, description: 'How many. Defaults to 10.' },
            },
        },
    },
    {
        name: 'read_output',
        description: 'The full text of one deliverable, by its title or a fragment of it.',
        parameters: {
            type: Type.OBJECT,
            properties: { title: { type: Type.STRING } },
            required: ['title'],
        },
    },
    {
        name: 'create_department',
        description:
            'Stand up a new standing department. This costs nothing and starts nothing — it creates the charter and waits. Use it when the CHO describes work they want done on an ongoing basis.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING, description: 'Short and descriptive, e.g. "Stock Market Research".' },
                charter: {
                    type: Type.STRING,
                    description:
                        'Two or three sentences on what this department is for, specific enough to staff from. Write it in the CHO\'s voice, capturing what they actually asked for.',
                },
                budgetUsd: { type: Type.NUMBER, description: 'Monthly cap. Default 5 if unspecified.' },
                cadenceCron: {
                    type: Type.STRING,
                    description: 'Optional 5-field cron, e.g. "0 7 * * 1-5" for weekday mornings.',
                },
            },
            required: ['name', 'charter'],
        },
    },
    {
        name: 'set_department_budget',
        description: 'Change a department\'s spending cap.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                department: { type: Type.STRING, description: 'Name or a fragment of it.' },
                budgetUsd: { type: Type.NUMBER },
            },
            required: ['department', 'budgetUsd'],
        },
    },
    {
        name: 'set_system_mode',
        description:
            'Turn the whole organisation on, pause it, or stop it. Pausing and stopping are always allowed — they reduce what is happening. Setting it back to running is allowed too, since the CHO is asking for it in this conversation.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                mode: { type: Type.STRING, enum: ['running', 'paused', 'stopped'] },
                reason: { type: Type.STRING },
            },
            required: ['mode'],
        },
    },
];

function toolDeclarations(): FunctionDeclaration[] {
    return TOOLS;
}

const SYSTEM = `${DELPHI_SYSTEM_PROMPT}

You are talking directly to the CHO. This is a conversation, not a report — answer
in a few sentences unless they ask for depth. No markdown headings.

You can act from this conversation. Read the organisation's state before
answering anything about how it is going; do not describe from memory what you
can look up.

What you may do: create departments, change budgets, pause or resume the system,
and read anything.

What you may not do, ever:

- Approve a staffing plan. You propose teams; the CHO approves them. Approving
  your own plan would be approving your own spending.
- Decide anything sitting in the approvals queue. Those are outward-facing
  actions — posts, publishes, sends, spends. Only the CHO consents to those.
  You can tell them what is waiting and what you would recommend.

If the CHO asks you to do one of those, say plainly that it is theirs to click
and point them at it. Do not treat their asking as permission — the separation
is the point, not a formality.

Be honest about failure. If something broke, say what and why. Never report
work as done that is not done.`;

interface ToolContext {
    db: Db;
    workspaceId: string;
    actions: string[];
}

async function runTool(
    ctx: ToolContext,
    name: string,
    args: Record<string, unknown>
): Promise<{ content: string }> {
    const { db, workspaceId } = ctx;

    switch (name) {
        case 'get_status': {
            const [{ data: depts }, { data: projects }, { data: approvals }, { data: events }, mode] =
                await Promise.all([
                    db.from('delphi_departments').select('id, name, status, budget_usd, spent_usd, cadence_cron').eq('workspace_id', workspaceId),
                    db.from('delphi_projects').select('title, status, spent_usd').eq('workspace_id', workspaceId),
                    db.from('delphi_approvals').select('summary, action_type, risk').eq('workspace_id', workspaceId).eq('status', 'pending'),
                    db.from('delphi_events').select('type, payload').eq('workspace_id', workspaceId).order('id', { ascending: false }).limit(15),
                    getSystemMode(db, workspaceId),
                ]);

            return {
                content: JSON.stringify({
                    systemMode: mode,
                    departments: (depts ?? []).map((d) => ({
                        name: d.name,
                        status: d.status,
                        spent: formatUsd(Number(d.spent_usd ?? 0)),
                        budget: formatUsd(Number(d.budget_usd ?? 0)),
                        cadence: d.cadence_cron ?? null,
                    })),
                    projects: (projects ?? []).map((p) => ({ title: p.title, status: p.status })),
                    awaitingTheCHO: (approvals ?? []).map((a) => ({
                        what: a.summary,
                        type: a.action_type,
                        risk: a.risk,
                    })),
                    recentActivity: (events ?? []).map((e) => {
                        const p = (e.payload ?? {}) as Record<string, unknown>;
                        return `${p.actor ?? ''} ${p.verb ?? e.type} ${p.object ?? ''}`.trim();
                    }),
                }),
            };
        }

        case 'list_outputs': {
            const limit = Math.min(Number(args.limit ?? 10) || 10, 25);
            const { data } = await db
                .from('delphi_artifacts')
                .select('title, kind, created_at, task:delphi_tasks ( agent:delphi_agents ( name ) )')
                .eq('workspace_id', workspaceId)
                .order('created_at', { ascending: false })
                .limit(limit);

            return {
                content: JSON.stringify(
                    (data ?? []).map((a) => ({
                        title: a.title,
                        kind: a.kind,
                        by: ((a.task as unknown as { agent?: { name?: string } })?.agent?.name) ?? 'unknown',
                        at: a.created_at,
                    }))
                ),
            };
        }

        case 'read_output': {
            const title = String(args.title ?? '');
            const { data } = await db
                .from('delphi_artifacts')
                .select('title, content_md')
                .eq('workspace_id', workspaceId)
                .ilike('title', `%${title}%`)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!data) return { content: `No deliverable matching "${title}".` };
            return {
                content: `${data.title}\n\n${String(data.content_md ?? '').slice(0, 8000)}`,
            };
        }

        case 'create_department': {
            const name = String(args.name ?? '').trim();
            const charter = String(args.charter ?? '').trim();
            if (!name || charter.length < 20) {
                return { content: 'Rejected: a department needs a name and a charter of at least a sentence or two.' };
            }

            const { data, error } = await db
                .from('delphi_departments')
                .insert({
                    workspace_id: workspaceId,
                    name,
                    charter,
                    budget_usd: Number(args.budgetUsd ?? 5) || 5,
                    cadence_cron: args.cadenceCron ? String(args.cadenceCron) : null,
                    status: 'draft',
                })
                .select('id')
                .single();

            if (error) return { content: `Could not create it: ${error.message}` };

            await emitEvent(db, {
                workspaceId,
                departmentId: data.id,
                type: 'department_created',
                actor: 'Delphi',
                verb: 'created a department from your conversation',
                object: name,
            });

            ctx.actions.push(`Created the ${name} department`);
            return {
                content: `Created "${name}" as a draft. Nothing is staffed and nothing is spending. The CHO opens it and asks you to staff it when they are ready.`,
            };
        }

        case 'set_department_budget': {
            const needle = String(args.department ?? '');
            const budget = Number(args.budgetUsd);
            if (!Number.isFinite(budget) || budget < 0) return { content: 'Rejected: budget must be a positive number.' };

            const { data: dept } = await db
                .from('delphi_departments')
                .select('id, name')
                .eq('workspace_id', workspaceId)
                .ilike('name', `%${needle}%`)
                .limit(1)
                .maybeSingle();

            if (!dept) return { content: `No department matching "${needle}".` };

            await db.from('delphi_departments').update({ budget_usd: budget }).eq('id', dept.id);
            ctx.actions.push(`Set ${dept.name}'s budget to ${formatUsd(budget)}`);
            return { content: `${dept.name} now caps at ${formatUsd(budget)}.` };
        }

        case 'set_system_mode': {
            const mode = String(args.mode ?? '') as 'running' | 'paused' | 'stopped';
            if (!['running', 'paused', 'stopped'].includes(mode)) {
                return { content: 'Rejected: mode must be running, paused or stopped.' };
            }

            await setSystemMode(db, workspaceId, mode, String(args.reason ?? 'Set from a conversation with the CHO'));
            await emitEvent(db, {
                workspaceId,
                type: 'system_mode_changed',
                actor: 'Delphi',
                verb: `set the system to ${mode}, as asked`,
                object: String(args.reason ?? ''),
            });

            ctx.actions.push(`Set the system to ${mode}`);
            return { content: `System is now ${mode}.` };
        }

        default:
            return { content: `No such capability: ${name}.` };
    }
}

/**
 * One turn of conversation.
 *
 * History is replayed rather than summarised — these are short exchanges, and
 * a CEO that forgets what it was just asked is worse than one that costs a
 * fraction more.
 */
export async function chatWithDelphi(
    db: Db,
    workspaceId: string,
    history: ChatTurn[],
    message: string
): Promise<ChatResult> {
    const ctx: ToolContext = { db, workspaceId, actions: [] };

    const transcript = history
        .slice(-12)
        .map((t) => `${t.role === 'cho' ? 'CHO' : 'You'}: ${t.content}`)
        .join('\n\n');

    const prompt = transcript
        ? `${transcript}\n\nCHO: ${message}`
        : `CHO: ${message}`;

    const result = await generateWithTools<{ reply: string }>(
        prompt,
        toolDeclarations(),
        (name, args) => runTool(ctx, name, args),
        RESPONSE_SCHEMA,
        (value) => {
            const v = value as { reply?: unknown };
            if (typeof v?.reply !== 'string' || !v.reply.trim()) {
                throw new Error('Delphi returned no reply.');
            }
            return { reply: v.reply.trim() };
        },
        { system: SYSTEM, model: MODEL, temperature: 0.6, maxToolTurns: 6 }
    );

    return {
        reply: result.data.reply,
        actions: ctx.actions,
        costUsd: result.costUsd,
        model: result.model,
    };
}
