/**
 * L3 wrapper around the L2 LLM provider factory.
 *
 * Wraps getProvider(), resetProvider(), and getProviderName() so that
 * L4 agents import from L3 (allowed) instead of L2 (blocked by layer rules).
 */
import { getProvider as _getProvider, resetProvider as _resetProvider, getProviderName as _getProviderName } from '../../L2-clients/llm/index.js'

export function getProvider(...args: Parameters<typeof _getProvider>): ReturnType<typeof _getProvider> {
  return _getProvider(...args)
}

export function resetProvider(...args: Parameters<typeof _resetProvider>): ReturnType<typeof _resetProvider> {
  return _resetProvider(...args)
}

export function getProviderName(...args: Parameters<typeof _getProviderName>): ReturnType<typeof _getProviderName> {
  return _getProviderName(...args)
}

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
