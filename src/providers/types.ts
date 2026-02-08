/**
 * LLM Provider Abstraction Layer
 *
 * Defines the contract for all LLM providers (Copilot SDK, OpenAI, Claude).
 * Providers normalize different SDK patterns into a unified interface.
 */

/** Supported LLM provider names */
export type ProviderName = 'copilot' | 'openai' | 'claude'

/** Tool definition in JSON Schema format (compatible with all providers) */
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema object
}

/** A tool call requested by the LLM */
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/** Token usage for a single LLM call */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** Cost information for a single LLM call */
export interface CostInfo {
  /** Provider-specific cost (e.g., USD for OpenAI/Claude, PRUs for Copilot) */
  amount: number
  /** Unit of measurement */
  unit: 'usd' | 'premium_requests'
  /** Model used */
  model: string
  /** Model multiplier (for Copilot PRU calculation) */
  multiplier?: number
}

/** Copilot-specific quota snapshot from assistant.usage event */
export interface QuotaSnapshot {
  isUnlimitedEntitlement: boolean
  entitlementRequests: number
  usedRequests: number
  remainingPercentage: number
  resetDate?: string
  overage: number
}

/** Response from an LLM provider call */
export interface LLMResponse {
  /** Text content of the response */
  content: string
  /** Tool calls requested by the LLM (if any) */
  toolCalls: ToolCall[]
  /** Token usage metrics */
  usage: TokenUsage
  /** Cost information */
  cost?: CostInfo
  /** Copilot quota snapshots (only for Copilot provider) */
  quotaSnapshots?: Record<string, QuotaSnapshot>
  /** Duration of the call in milliseconds */
  durationMs?: number
}

/** Event types emitted by provider sessions */
export type ProviderEventType =
  | 'delta' // Streaming text chunk
  | 'tool_start' // Tool execution starting
  | 'tool_end' // Tool execution complete
  | 'usage' // Token usage update
  | 'error' // Error occurred

/** Event data for provider events */
export interface ProviderEvent {
  type: ProviderEventType
  data: unknown
}

/** Tool handler function - executes tool logic and returns result */
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>

/** Tool with its handler attached */
export interface ToolWithHandler extends ToolDefinition {
  handler: ToolHandler
}

/** Configuration for creating a provider session */
export interface SessionConfig {
  /** System prompt for the LLM */
  systemPrompt: string
  /** Tools available to the LLM */
  tools: ToolWithHandler[]
  /** Whether to enable streaming */
  streaming?: boolean
  /** Model to use (provider-specific, e.g., 'claude-sonnet-4', 'gpt-4o') */
  model?: string
  /** Timeout in milliseconds */
  timeoutMs?: number
}

/** An active session with an LLM provider */
export interface LLMSession {
  /** Send a message and wait for the complete response */
  sendAndWait(message: string): Promise<LLMResponse>
  /** Subscribe to session events */
  on(event: ProviderEventType, handler: (event: ProviderEvent) => void): void
  /** Close and clean up the session */
  close(): Promise<void>
}

/** LLM Provider interface - the main contract */
export interface LLMProvider {
  /** Provider name identifier */
  readonly name: ProviderName
  /** Create a new session with the given configuration */
  createSession(config: SessionConfig): Promise<LLMSession>
  /** Check if the provider is available (API key set, etc.) */
  isAvailable(): boolean
  /** Get the default model for this provider */
  getDefaultModel(): string
  /** Optional lifecycle hook to release provider-level resources. */
  close?(): Promise<void>
}
