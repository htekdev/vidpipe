import type { LLMProvider, LLMSession, ToolWithHandler, MCPServerConfig, UserInputHandler } from '../L3-services/llm/providerFactory.js'
import { getProvider } from '../L3-services/llm/index.js'
import { getModelForAgent } from '../L1-infra/config/modelConfig.js'
import { costTracker } from '../L3-services/costTracking/costTracker.js'
import logger from '../L1-infra/logger/configLogger.js'

/**
 * BaseAgent — abstract foundation for all LLM-powered agents.
 *
 * ### Agent pattern
 * Each agent in the pipeline (SummaryAgent, ShortsAgent, BlogAgent, etc.)
 * extends BaseAgent and implements two methods:
 * - `getTools()` — declares the tools (functions) the LLM can call
 * - `handleToolCall()` — dispatches tool invocations to concrete implementations
 *
 * ### Tool registration
 * Tools are declared as JSON Schema objects and passed to the LLMSession
 * at creation time. When the LLM decides to call a tool, the provider routes
 * the call through the tool handler where the subclass executes the actual
 * logic (e.g. reading files, running FFmpeg, querying APIs).
 *
 * ### Message flow
 * 1. `run(userMessage)` lazily creates an LLMSession via the configured
 *    provider (Copilot, OpenAI, or Claude).
 * 2. The user message is sent via `sendAndWait()`, which blocks until the
 *    LLM produces a final response (with a 5-minute timeout).
 * 3. During processing, the LLM may invoke tools multiple times — each call
 *    is logged via session event handlers.
 * 4. The final assistant message text is returned to the caller.
 *
 * Sessions are reusable: calling `run()` multiple times on the same agent
 * sends additional messages within the same conversation context.
 */
export abstract class BaseAgent {
  protected provider: LLMProvider
  protected session: LLMSession | null = null
  protected readonly model?: string

  constructor(
    protected readonly agentName: string,
    protected readonly systemPrompt: string,
    provider?: LLMProvider,
    model?: string,
  ) {
    this.provider = provider ?? getProvider()
    this.model = model
  }

  /** Tools this agent exposes to the LLM. Override in subclasses. */
  protected getTools(): ToolWithHandler[] {
    return []
  }

  /** MCP servers this agent needs. Override in subclasses that use MCP tools. */
  protected getMcpServers(): Record<string, MCPServerConfig> | undefined {
    return undefined
  }

  /** User input handler for ask_user requests. Override in subclasses that need interactive user input. */
  protected getUserInputHandler(): UserInputHandler | undefined {
    return undefined
  }

  /** Timeout for sendAndWait calls. Override in interactive agents that need longer timeouts. */
  protected getTimeoutMs(): number {
    return 300_000 // 5 minutes
  }

  /** Dispatch a tool call to the concrete agent. Override in subclasses. */
  protected abstract handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown>

  /**
   * Reset agent-specific state before a retry attempt.
   * Override in subclasses that accumulate state via tool calls.
   */
  protected resetForRetry(): void {
    // No-op by default — subclasses override to clear accumulated state
  }

  /** Max retries for transient API errors (stream drops, rate limits). */
  private static readonly MAX_RETRIES = 3

  /**
   * Send a user message to the agent and return the final response text.
   *
   * 1. Lazily creates an LLMSession via the provider
   * 2. Registers event listeners for logging
   * 3. Calls sendAndWait and records usage via CostTracker
   * 4. Retries on transient errors (stream drops, rate limits) with backoff
   */
  async run(userMessage: string): Promise<string> {
    let lastError: unknown

    for (let attempt = 1; attempt <= BaseAgent.MAX_RETRIES; attempt++) {
      try {
        if (!this.session) {
          this.session = await this.provider.createSession({
            systemPrompt: this.systemPrompt,
            tools: this.getTools(),
            streaming: true,
            model: this.model ?? getModelForAgent(this.agentName),
            timeoutMs: this.getTimeoutMs(),
            mcpServers: this.getMcpServers(),
            onUserInputRequest: this.getUserInputHandler(),
          })
          this.setupEventHandlers(this.session)
        }

        logger.info(`[${this.agentName}] Sending message (attempt ${attempt}/${BaseAgent.MAX_RETRIES}): ${userMessage.substring(0, 80)}…`)

        costTracker.setAgent(this.agentName)
        const response = await this.session.sendAndWait(userMessage)

        // Record usage via CostTracker
        costTracker.recordUsage(
          this.provider.name,
          response.cost?.model ?? this.provider.getDefaultModel(),
          response.usage,
          response.cost,
          response.durationMs,
          response.quotaSnapshots
            ? Object.values(response.quotaSnapshots)[0]
            : undefined,
        )

        const content = response.content
        logger.info(`[${this.agentName}] Response received (${content.length} chars)`)
        return content
      } catch (err) {
        lastError = err
        const message = err instanceof Error ? err.message : String(err)

        if (!BaseAgent.isRetryableError(message) || attempt === BaseAgent.MAX_RETRIES) {
          throw err
        }

        // Destroy old session — close() + null prevents stale callbacks
        const staleSession = this.session
        this.session = null
        try { await staleSession?.close() } catch { /* best-effort cleanup */ }

        // Reset subclass state (e.g. plannedShorts, plannedClips) accumulated during the failed attempt
        this.resetForRetry()

        const delayMs = 2000 * Math.pow(2, attempt - 1) // 2s, 4s, 8s
        logger.warn(`[${this.agentName}] Transient error (attempt ${attempt}/${BaseAgent.MAX_RETRIES}), retrying in ${delayMs / 1000}s: ${message}`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }

    throw lastError
  }

  /** Check if an error message indicates a transient/retryable failure. */
  private static isRetryableError(message: string): boolean {
    const retryablePatterns = [
      'missing finish_reason',
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'socket hang up',
      'network error',
      'rate limit',
      '429',
      '500',
      '502',
      '503',
      '504',
      'stream ended',
      'aborted',
    ]
    const lower = message.toLowerCase()
    return retryablePatterns.some(p => lower.includes(p.toLowerCase()))
  }

  /** Wire up session event listeners for logging. Override for custom display. */
  protected setupEventHandlers(session: LLMSession): void {
    session.on('delta', (event) => {
      logger.debug(`[${this.agentName}] delta: ${JSON.stringify(event.data)}`)
    })

    session.on('tool_start', (event) => {
      logger.info(`[${this.agentName}] tool start: ${JSON.stringify(event.data)}`)
    })

    session.on('tool_end', (event) => {
      logger.info(`[${this.agentName}] tool done: ${JSON.stringify(event.data)}`)
    })

    session.on('error', (event) => {
      logger.error(`[${this.agentName}] error: ${JSON.stringify(event.data)}`)
    })
  }

  /** Tear down the session. */
  async destroy(): Promise<void> {
    try {
      if (this.session) {
        await this.session.close()
        this.session = null
      }
    } catch (err) {
      logger.error(`[${this.agentName}] Error during destroy: ${err}`)
    }
  }
}
