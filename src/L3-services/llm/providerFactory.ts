/**
 * L3 wrapper around the L2 LLM provider factory.
 *
 * Wraps getProvider(), resetProvider(), and getProviderName() so that
 * L4 agents import from L3 (allowed) instead of L2 (blocked by layer rules).
 */
import {
  getProvider as _getProvider,
  resetProvider as _resetProvider,
  getProviderName as _getProviderName,
} from '../../L2-clients/llm/index.js'
import type { ProviderName } from '../../L2-clients/llm/types.js'
import type { LLMProvider } from '../../L2-clients/llm/types.js'

export function getProvider(name?: ProviderName): LLMProvider {
  return _getProvider(name)
}

export async function resetProvider(): Promise<void> {
  return _resetProvider()
}

export function getProviderName(): ProviderName {
  return _getProviderName()
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
