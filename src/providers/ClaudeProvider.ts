/**
 * Claude (Anthropic) LLM Provider
 *
 * Wraps the Anthropic Messages API behind the LLMProvider interface.
 * Uses direct @anthropic-ai/sdk for tool-calling with our own agent loop.
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  ContentBlock,
  MessageParam,
  TextBlock,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages.js'
import { calculateTokenCost } from '../config/pricing.js'
import logger from '../config/logger.js'
import type {
  LLMProvider,
  LLMSession,
  LLMResponse,
  SessionConfig,
  ToolWithHandler,
  TokenUsage,
  ProviderEventType,
  ProviderEvent,
} from './types.js'

const DEFAULT_MODEL = 'claude-sonnet-4-20250514'
const DEFAULT_MAX_TOKENS = 8192

/** Convert our ToolWithHandler[] to Anthropic tool format */
function toAnthropicTools(tools: ToolWithHandler[]): Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Tool['input_schema'],
  }))
}

/** Extract text content from Anthropic response content blocks */
function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

/** Extract tool_use blocks from Anthropic response */
function extractToolUse(content: ContentBlock[]): ToolUseBlock[] {
  return content.filter((b): b is ToolUseBlock => b.type === 'tool_use')
}

class ClaudeSession implements LLMSession {
  private client: Anthropic
  private systemPrompt: string
  private tools: ToolWithHandler[]
  private anthropicTools: Tool[]
  private messages: MessageParam[] = []
  private model: string
  private maxTokens: number
  private handlers = new Map<ProviderEventType, ((event: ProviderEvent) => void)[]>()

  constructor(client: Anthropic, config: SessionConfig) {
    this.client = client
    this.systemPrompt = config.systemPrompt
    this.tools = config.tools
    this.anthropicTools = toAnthropicTools(config.tools)
    this.model = config.model ?? DEFAULT_MODEL
    this.maxTokens = DEFAULT_MAX_TOKENS
  }

  on(event: ProviderEventType, handler: (event: ProviderEvent) => void): void {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
  }

  private emit(type: ProviderEventType, data: unknown): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler({ type, data })
    }
  }

  async sendAndWait(message: string): Promise<LLMResponse> {
    this.messages.push({ role: 'user', content: message })

    let cumulativeUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    }

    // Agent loop: keep calling until no more tool_use
    while (true) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: this.systemPrompt,
        messages: this.messages,
        ...(this.anthropicTools.length > 0 ? { tools: this.anthropicTools } : {}),
      })

      // Accumulate usage
      cumulativeUsage.inputTokens += response.usage.input_tokens
      cumulativeUsage.outputTokens += response.usage.output_tokens
      cumulativeUsage.totalTokens =
        cumulativeUsage.inputTokens + cumulativeUsage.outputTokens

      if (response.usage.cache_read_input_tokens) {
        cumulativeUsage.cacheReadTokens =
          (cumulativeUsage.cacheReadTokens ?? 0) + response.usage.cache_read_input_tokens
      }
      if (response.usage.cache_creation_input_tokens) {
        cumulativeUsage.cacheWriteTokens =
          (cumulativeUsage.cacheWriteTokens ?? 0) + response.usage.cache_creation_input_tokens
      }

      this.emit('usage', cumulativeUsage)

      // Add assistant response to history
      this.messages.push({ role: 'assistant', content: response.content })

      const toolUseBlocks = extractToolUse(response.content)

      if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
        // No tool calls — return final text
        const text = extractText(response.content)
        const cost = calculateTokenCost(
          this.model,
          cumulativeUsage.inputTokens,
          cumulativeUsage.outputTokens,
        )

        return {
          content: text,
          toolCalls: [],
          usage: cumulativeUsage,
          cost: cost > 0
            ? { amount: cost, unit: 'usd', model: this.model }
            : undefined,
        }
      }

      // Execute tool calls and build result messages
      const toolResults: ToolResultBlockParam[] = []

      for (const block of toolUseBlocks) {
        const tool = this.tools.find((t) => t.name === block.name)
        if (!tool) {
          logger.warn(`Claude requested unknown tool: ${block.name}`)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ error: `Unknown tool: ${block.name}` }),
          })
          continue
        }

        this.emit('tool_start', { name: block.name, arguments: block.input })

        try {
          const result = await tool.handler(block.input as Record<string, unknown>)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          })
          this.emit('tool_end', { name: block.name, result })
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logger.error(`Tool ${block.name} failed: ${errorMsg}`)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ error: errorMsg }),
            is_error: true,
          })
          this.emit('error', { name: block.name, error: errorMsg })
        }
      }

      // Add tool results as a user message and loop
      this.messages.push({ role: 'user', content: toolResults })
    }
  }

  async close(): Promise<void> {
    this.messages = []
    this.handlers.clear()
  }
}

export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude' as const

  isAvailable(): boolean {
    return !!process.env.ANTHROPIC_API_KEY
  }

  getDefaultModel(): string {
    return DEFAULT_MODEL
  }

  async createSession(config: SessionConfig): Promise<LLMSession> {
    const client = new Anthropic()
    return new ClaudeSession(client, config)
  }
}
