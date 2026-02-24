/**
 * CopilotProvider — wraps @github/copilot-sdk behind the LLMProvider interface.
 *
 * Extracts the Copilot-specific logic from BaseAgent into a reusable provider
 * that can be swapped with OpenAI or Claude providers via the abstraction layer.
 *
 * NOTE: Vision support for tool results is not available in the Copilot provider.
 * The @github/copilot-sdk handles tool calls internally, so we cannot inject
 * images into the conversation. Tools returning imagePath will have the path
 * included in the JSON result as text only.
 */

import { createCopilotClient } from './ai.js'
import type { SessionEvent } from './ai.js'
import type { CopilotClient, CopilotSession } from '../../L1-infra/ai/copilot.js'
import logger from '../../L1-infra/logger/configLogger.js'
import type {
  LLMProvider,
  LLMSession,
  LLMResponse,
  SessionConfig,
  TokenUsage,
  CostInfo,
  QuotaSnapshot,
  ToolCall,
  ProviderEvent,
  ProviderEventType,
  UserInputRequest,
} from './types'

const DEFAULT_MODEL = 'claude-opus-4.5'
const DEFAULT_TIMEOUT_MS = 300_000 // 5 minutes

export class CopilotProvider implements LLMProvider {
  readonly name = 'copilot' as const
  private client: CopilotClient | null = null

  isAvailable(): boolean {
    // Copilot uses GitHub auth, not an API key
    return true
  }

  getDefaultModel(): string {
    return DEFAULT_MODEL
  }

  async createSession(config: SessionConfig): Promise<LLMSession> {
    if (!this.client) {
      this.client = createCopilotClient({ autoStart: true, logLevel: 'error' })
    }

    const copilotSession = await this.client.createSession({
      model: config.model,
      mcpServers: config.mcpServers,
      systemMessage: { mode: 'replace', content: config.systemPrompt },
      tools: config.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        handler: t.handler,
      })),
      streaming: config.streaming ?? true,
      onUserInputRequest: config.onUserInputRequest
        ? (request: UserInputRequest) => config.onUserInputRequest!(request)
        : undefined,
    })

    return new CopilotSessionWrapper(
      copilotSession,
      config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
  }

  /** Tear down the underlying Copilot client. */
  async close(): Promise<void> {
    try {
      if (this.client) {
        await this.client.stop()
        this.client = null
      }
    } catch (err) {
      logger.error(`[CopilotProvider] Error during close: ${err}`)
    }
  }
}

/** Wraps a CopilotSession to satisfy the LLMSession interface. */
class CopilotSessionWrapper implements LLMSession {
  private eventHandlers = new Map<ProviderEventType, Array<(event: ProviderEvent) => void>>()

  // Latest usage data captured from assistant.usage events
  private lastUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  private lastCost: CostInfo | undefined
  private lastQuotaSnapshots: Record<string, QuotaSnapshot> | undefined
  
  // Track tool completions to handle partial success on SDK errors
  private toolsCompleted = 0

  constructor(
    private readonly session: CopilotSession,
    private readonly timeoutMs: number,
  ) {
    this.setupEventForwarding()
    this.setupUsageTracking()
  }

  async sendAndWait(message: string): Promise<LLMResponse> {
    const start = Date.now()

    // Reset usage tracking for this call
    this.lastUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    this.lastCost = undefined
    this.lastQuotaSnapshots = undefined
    this.toolsCompleted = 0

    let response: { data?: { content?: string } } | undefined
    let sdkError: Error | undefined

    try {
      response = await this.session.sendAndWait(
        { prompt: message },
        this.timeoutMs,
      )
    } catch (err) {
      sdkError = err instanceof Error ? err : new Error(String(err))
      
      // Handle the known "missing finish_reason" bug in @github/copilot SDK
      // This happens when the streaming response ends without proper termination
      // but tools may have already completed successfully
      if (sdkError.message.includes('missing finish_reason')) {
        if (this.toolsCompleted > 0) {
          logger.warn(`[CopilotProvider] SDK error after ${this.toolsCompleted} tool calls completed - treating as success`)
          // Return partial success - tools ran, just the final message was lost
        } else {
          // No tools completed, this is a real failure - rethrow
          throw sdkError
        }
      } else {
        throw sdkError
      }
    }

    const content = response?.data?.content ?? ''
    const toolCalls: ToolCall[] = [] // Copilot SDK handles tool calls internally

    return {
      content,
      toolCalls,
      usage: this.lastUsage,
      cost: this.lastCost,
      quotaSnapshots: this.lastQuotaSnapshots,
      durationMs: Date.now() - start,
    }
  }

  on(event: ProviderEventType, handler: (event: ProviderEvent) => void): void {
    const handlers = this.eventHandlers.get(event) ?? []
    handlers.push(handler)
    this.eventHandlers.set(event, handlers)
  }

  async close(): Promise<void> {
    // Add timeout to session.destroy() - it can hang on the same SDK bug
    const DESTROY_TIMEOUT_MS = 5000
    try {
      await Promise.race([
        this.session.destroy(),
        new Promise<void>((_, reject) => 
          setTimeout(() => reject(new Error('session.destroy() timed out')), DESTROY_TIMEOUT_MS)
        ),
      ])
    } catch (err) {
      // Log but don't rethrow - the session may be in a bad state but we still want to clean up
      logger.warn(`[CopilotProvider] Session destroy failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    this.eventHandlers.clear()
  }

  /** Capture assistant.usage events for token/cost tracking. */
  private setupUsageTracking(): void {
    this.session.on((event: SessionEvent) => {
      if (event.type === 'assistant.usage') {
        const d = event.data as Record<string, unknown>
        this.lastUsage = {
          inputTokens: (d.inputTokens as number) ?? 0,
          outputTokens: (d.outputTokens as number) ?? 0,
          totalTokens: ((d.inputTokens as number) ?? 0) + ((d.outputTokens as number) ?? 0),
          cacheReadTokens: d.cacheReadTokens as number | undefined,
          cacheWriteTokens: d.cacheWriteTokens as number | undefined,
        }
        if (d.cost != null) {
          this.lastCost = {
            amount: d.cost as number,
            unit: 'premium_requests',
            model: (d.model as string) ?? DEFAULT_MODEL,
            multiplier: d.multiplier as number | undefined,
          }
        }
        if (d.quotaSnapshots != null) {
          this.lastQuotaSnapshots = d.quotaSnapshots as Record<string, QuotaSnapshot>
        }
      }
    })
  }

  /** Forward CopilotSession events to ProviderEvent subscribers. */
  private setupEventForwarding(): void {
    this.session.on((event: SessionEvent) => {
      switch (event.type) {
        case 'assistant.message_delta':
          this.emit('delta', event.data)
          break
        case 'tool.execution_start':
          this.emit('tool_start', event.data)
          break
        case 'tool.execution_complete':
          this.toolsCompleted++
          this.emit('tool_end', event.data)
          break
        case 'assistant.usage':
          this.emit('usage', event.data)
          break
        case 'session.error':
          this.emit('error', event.data)
          break
      }
    })
  }

  private emit(type: ProviderEventType, data: unknown): void {
    const handlers = this.eventHandlers.get(type)
    if (handlers) {
      for (const handler of handlers) {
        handler({ type, data })
      }
    }
  }
}
