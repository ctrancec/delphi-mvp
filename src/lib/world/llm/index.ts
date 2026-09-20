/**
 * The agent turn: one pass of "look at the situation, think, use tools, report".
 *
 * Live mode runs the turn against the Claude API. Without an API key the world
 * still runs, on a scripted plan the caller supplies — agents walk, hire, open
 * tasks and finish them so the simulation is inspectable, but nothing is
 * actually reasoned about. `isLiveMode()` is what tells the two apart, and the
 * UI shows which one is in force.
 */

import { isLiveMode } from '../config'
import type { Capability } from '../roles'
import type { ToolSchema } from '../tools/definitions'
import { runAnthropicTurn } from './anthropic'

export interface ScriptedCall {
    name: string
    input: Record<string, unknown>
}

/** What the world should do for this turn when no model is available. */
export interface ScriptedPlan {
    text: string
    calls: ScriptedCall[]
}

export interface TurnRequest {
    model: string
    system: string
    /** Conversation so far. Plain strings or content-block arrays. */
    messages: { role: 'user' | 'assistant'; content: unknown }[]
    tools: ToolSchema[]
    capability: Capability | null
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    maxIterations: number
    onToolCall: (name: string, input: unknown) => Promise<string>
    fallbackPlan?: ScriptedPlan
}

export interface TurnResult {
    text: string
    toolCalls: string[]
    usage: { input: number; output: number }
    mode: 'live' | 'simulated'
    error?: string
}

export async function runTurn(req: TurnRequest): Promise<TurnResult> {
    if (isLiveMode()) {
        try {
            return await runAnthropicTurn(req)
        } catch (err) {
            const message = (err as Error).message
            console.error('[world] agent turn failed:', message)
            return {
                text: '',
                toolCalls: [],
                usage: { input: 0, output: 0 },
                mode: 'live',
                error: message,
            }
        }
    }
    return runScriptedTurn(req)
}

async function runScriptedTurn(req: TurnRequest): Promise<TurnResult> {
    const plan = req.fallbackPlan
    if (!plan) {
        return {
            text: '',
            toolCalls: [],
            usage: { input: 0, output: 0 },
            mode: 'simulated',
        }
    }
    const called: string[] = []
    for (const call of plan.calls) {
        await req.onToolCall(call.name, call.input)
        called.push(call.name)
    }
    return { text: plan.text, toolCalls: called, usage: { input: 0, output: 0 }, mode: 'simulated' }
}
