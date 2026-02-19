/**
 * L3 wrapper around the L2 LLM provider factory.
 *
 * Re-exports getProvider(), resetProvider(), and getProviderName() so that
 * L4 agents import from L3 (allowed) instead of L2 (blocked by layer rules).
 */
export { getProvider, resetProvider, getProviderName } from '../../L2-clients/llm/index.js'

// Re-export types that L4 agents need
export type {
  LLMProvider,
  LLMSession,
  LLMResponse,
  SessionConfig,
  ToolWithHandler,
  TokenUsage,
  CostInfo,
  QuotaSnapshot,
  ProviderEvent,
  ProviderEventType,
  ProviderName,
  ToolDefinition,
  ToolCall,
  ToolHandler,
  ImageContent,
  ImageMimeType,
  MCPServerConfig,
  MCPLocalServerConfig,
  MCPRemoteServerConfig,
  UserInputRequest,
  UserInputResponse,
  UserInputHandler,
} from '../../L2-clients/llm/types.js'
