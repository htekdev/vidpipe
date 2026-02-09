import type { LLMProvider, LLMSession, ToolWithHandler, MCPServerConfig } from '../providers/types.js'
import { getProvider } from '../providers/index.js'
import { getModelForAgent } from '../config/modelConfig.js'
import { costTracker } from '../services/costTracker.js'
import logger from '../config/logger.js'

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

  /** Dispatch a tool call to the concrete agent. Override in subclasses. */
  protected abstract handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown>

  /**
   * Send a user message to the agent and return the final response text.
   *
   * 1. Lazily creates an LLMSession via the provider
   * 2. Registers event listeners for logging
   * 3. Calls sendAndWait and records usage via CostTracker
   */
  async run(userMessage: string): Promise<string> {
    if (!this.session) {
      this.session = await this.provider.createSession({
        systemPrompt: this.systemPrompt,
        tools: this.getTools(),
        streaming: true,
        model: this.model ?? getModelForAgent(this.agentName),
        timeoutMs: 300_000, // 5 min timeout
        mcpServers: this.getMcpServers(),
      })
      this.setupEventHandlers(this.session)
    }

    logger.info(`[${this.agentName}] Sending message: ${userMessage.substring(0, 80)}…`)

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
  }

  /** Wire up session event listeners for logging. */
  private setupEventHandlers(session: LLMSession): void {
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
