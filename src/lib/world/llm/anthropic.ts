import Anthropic from '@anthropic-ai/sdk'
import { LIMITS, anthropicApiKey } from '../config'
import type { TurnRequest, TurnResult } from './index'

let cached: Anthropic | null = null

function client(): Anthropic {
    if (cached) return cached
    const apiKey = anthropicApiKey()
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
    cached = new Anthropic({ apiKey })
    return cached
}

/**
 * Server tools, gated by the agent's capability.
 *
 * `web_search_20260209` filters its results inside its own code-execution
 * environment, so an agent gets search *or* code execution — never both in the
 * same request.
 */
function serverTools(capability: TurnRequest['capability']) {
    if (capability === 'search') {
        return {
            tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
            betas: [] as string[],
        }
    }
    if (capability === 'code') {
        return {
            tools: [{ type: 'code_execution_20260521', name: 'code_execution' }],
            betas: ['code-execution-2025-08-25'],
        }
    }
    return { tools: [], betas: [] as string[] }
}

export async function runAnthropicTurn(req: TurnRequest): Promise<TurnResult> {
    const anthropic = client()
    const server = serverTools(req.capability)

    const messages = req.messages.map((m) => ({
        role: m.role,
        content: m.content,
    })) as Anthropic.Beta.BetaMessageParam[]

    const tools = [
        ...req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
            strict: true,
        })),
        ...server.tools,
    ] as Anthropic.Beta.BetaToolUnion[]

    const toolCalls: string[] = []
    let text = ''
    let inputTokens = 0
    let outputTokens = 0

    for (let iteration = 0; iteration < req.maxIterations; iteration++) {
        const response = await anthropic.beta.messages.create({
            model: req.model,
            max_tokens: LIMITS.maxOutputTokens,
            system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
            messages,
            tools,
            thinking: { type: 'adaptive' },
            output_config: { effort: req.effort ?? 'high' },
            ...(server.betas.length ? { betas: server.betas } : {}),
        })

        inputTokens += response.usage.input_tokens ?? 0
        outputTokens += response.usage.output_tokens ?? 0

        if (response.stop_reason === 'refusal') {
            return {
                text,
                toolCalls,
                usage: { input: inputTokens, output: outputTokens },
                mode: 'live',
                error: `The model declined this request (${response.stop_details?.category ?? 'unspecified'}).`,
            }
        }

        // Thinking blocks and server-tool results must go back unchanged.
        messages.push({ role: 'assistant', content: response.content })

        for (const block of response.content) {
            if (block.type === 'text') text += (text ? '\n' : '') + block.text
        }

        // The server paused mid-turn (long-running server tool) — resume it.
        if (response.stop_reason === 'pause_turn') continue

        const toolUses = response.content.filter(
            (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use'
        )
        if (toolUses.length === 0) break

        // All results for one assistant turn go back in a single user message.
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
        for (const use of toolUses) {
            toolCalls.push(use.name)
            let content: string
            let isError = false
            try {
                content = await req.onToolCall(use.name, use.input)
            } catch (err) {
                content = `Tool failed: ${(err as Error).message}`
                isError = true
            }
            results.push({
                type: 'tool_result',
                tool_use_id: use.id,
                content: content || '(no output)',
                ...(isError ? { is_error: true } : {}),
            })
        }
        messages.push({ role: 'user', content: results })
    }

    return {
        text: text.trim(),
        toolCalls,
        usage: { input: inputTokens, output: outputTokens },
        mode: 'live',
    }
}
