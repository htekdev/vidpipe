import { CopilotClient, CopilotSession, Tool, SessionEvent } from '@github/copilot-sdk'
import logger from '../config/logger'

/**
 * BaseAgent — abstract foundation for all Copilot SDK agents.
 *
 * Subclasses implement `getTools()` and `handleToolCall()` to define
 * agent-specific behaviour.  The `run()` method wires up a session,
 * streams the response, and returns the final assistant message.
 */
export abstract class BaseAgent {
  protected client: CopilotClient | null = null
  protected session: CopilotSession | null = null

  constructor(
    protected readonly agentName: string,
    protected readonly systemPrompt: string,
  ) {}

  /** Tools this agent exposes to the LLM. Override in subclasses. */
  protected getTools(): Tool<unknown>[] {
    return []
  }

  /** Dispatch a tool call to the concrete agent. Override in subclasses. */
  protected abstract handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown>

  /**
   * Send a user message to the agent and return the final response text.
   *
   * 1. Lazily creates a CopilotClient + CopilotSession
   * 2. Registers an event listener to accumulate the response
   * 3. Calls sendAndWait and returns the completed message
   */
  async run(userMessage: string): Promise<string> {
    if (!this.client) {
      this.client = new CopilotClient({ autoStart: true, logLevel: 'error' })
    }

    if (!this.session) {
      this.session = await this.client.createSession({
        systemMessage: { mode: 'replace', content: this.systemPrompt },
        tools: this.getTools(),
        streaming: true,
      })
      this.setupEventHandlers(this.session)
    }

    logger.info(`[${this.agentName}] Sending message: ${userMessage.substring(0, 80)}…`)

    const response = await this.session.sendAndWait(
      { prompt: userMessage },
      300_000, // 5 min timeout
    )

    const content = response?.data?.content ?? ''
    logger.info(`[${this.agentName}] Response received (${content.length} chars)`)
    return content
  }

  /** Wire up session event listeners for logging / streaming. */
  private setupEventHandlers(session: CopilotSession): void {
    session.on((event: SessionEvent) => {
      switch (event.type) {
        case 'assistant.message_delta':
          // Streaming delta — log at debug level to avoid noise
          logger.debug(`[${this.agentName}] delta: ${event.data.deltaContent}`)
          break

        case 'assistant.message':
          logger.debug(`[${this.agentName}] message complete`)
          break

        case 'tool.execution_start':
          logger.info(`[${this.agentName}] tool start: ${event.data.toolName}`)
          break

        case 'tool.execution_complete':
          logger.info(
            `[${this.agentName}] tool done: ${event.data.toolCallId} success=${event.data.success}`,
          )
          break

        case 'session.error':
          logger.error(`[${this.agentName}] error: ${event.data.message}`)
          break
      }
    })
  }

  /** Tear down the client + session. */
  async destroy(): Promise<void> {
    try {
      if (this.session) {
        await this.session.destroy()
        this.session = null
      }
      if (this.client) {
        await this.client.stop()
        this.client = null
      }
    } catch (err) {
      logger.error(`[${this.agentName}] Error during destroy: ${err}`)
    }
  }
}
