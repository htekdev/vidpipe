/**
 * Claude (Anthropic) LLM Provider
 *
 * Wraps the Anthropic Messages API behind the LLMProvider interface.
 * Uses direct @anthropic-ai/sdk for tool-calling with our own agent loop.
 */

import { createAnthropic } from './ai.js'
import type Anthropic from '@anthropic-ai/sdk'
import type {
  ContentBlock,
  ContentBlockParam,
  ImageBlockParam,
  MessageParam,
  TextBlock,
  TextBlockParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages.js'
import { calculateTokenCost } from '../../L0-pure/pricing/pricing.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { getConfig } from '../../L1-infra/config/environment.js'
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
import { hasImagePath, extractImage } from './imageUtils.js'

const DEFAULT_MODEL = 'claude-opus-4.6'
const DEFAULT_MAX_TOKENS = 8192
const MAX_TOOL_ROUNDS = 50

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
  private timeoutMs?: number

  constructor(client: Anthropic, config: SessionConfig) {
    this.client = client
    this.systemPrompt = config.systemPrompt
    this.tools = config.tools
    this.anthropicTools = toAnthropicTools(config.tools)
    this.model = config.model ?? DEFAULT_MODEL
    this.maxTokens = DEFAULT_MAX_TOKENS
    this.timeoutMs = config.timeoutMs
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

    const startMs = Date.now()

    // Agent loop: keep calling until no more tool_use
    let toolRound = 0
    while (true) {
      if (++toolRound > MAX_TOOL_ROUNDS) {
        logger.warn(`Claude agent exceeded ${MAX_TOOL_ROUNDS} tool rounds — aborting to prevent runaway`)
        throw new Error(`Max tool rounds (${MAX_TOOL_ROUNDS}) exceeded — possible infinite loop`)
      }
      const controller = new AbortController()
      const timeoutId = this.timeoutMs
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : undefined
      let response: Anthropic.Messages.Message
      try {
        response = await this.client.messages.create(
          {
            model: this.model,
            max_tokens: this.maxTokens,
            system: this.systemPrompt,
            messages: this.messages,
            ...(this.anthropicTools.length > 0 ? { tools: this.anthropicTools } : {}),
          },
          { signal: controller.signal },
        )
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
      }

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
          durationMs: Date.now() - startMs,
        }
      }

      // Execute tool calls and build result messages
      const toolResults: ToolResultBlockParam[] = []
      const pendingImageBlocks: ContentBlockParam[] = []

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

          // Check if result contains an image path
          if (hasImagePath(result)) {
            const extracted = await extractImage(result)
            if (extracted) {
              const textBlock: TextBlockParam = {
                type: 'text',
                text: `[Image from tool ${block.name}: ${extracted.path}]`,
              }
              const imageBlock: ImageBlockParam = {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: extracted.mimeType,
                  data: extracted.base64,
                },
              }
              pendingImageBlocks.push(textBlock, imageBlock)
            }
          }
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

      // Add tool results as a user message
      this.messages.push({ role: 'user', content: toolResults })

      // If we have images, add them as a follow-up user message
      if (pendingImageBlocks.length > 0) {
        this.messages.push({ role: 'user', content: pendingImageBlocks })
      }
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
    return !!getConfig().ANTHROPIC_API_KEY
  }

  getDefaultModel(): string {
    return DEFAULT_MODEL
  }

  async createSession(config: SessionConfig): Promise<LLMSession> {
    const client = createAnthropic()
    return new ClaudeSession(client, config)
  }
}
