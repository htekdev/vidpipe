import type { LLMProvider } from './types.js';
import type { ProviderName } from './types.js';
import { CopilotProvider } from './CopilotProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { ClaudeProvider } from './ClaudeProvider.js';
import logger from '../config/logger.js';

const providers: Record<ProviderName, () => LLMProvider> = {
  copilot: () => new CopilotProvider(),
  openai: () => new OpenAIProvider(),
  claude: () => new ClaudeProvider(),
};

/** Cached singleton provider instance */
let currentProvider: LLMProvider | null = null;
let currentProviderName: ProviderName | null = null;

/**
 * Get the configured LLM provider.
 * Reads from LLM_PROVIDER env var, defaults to 'copilot'.
 * Caches the instance for reuse.
 */
export function getProvider(name?: ProviderName): LLMProvider {
  const raw = name ?? (process.env.LLM_PROVIDER || 'copilot').trim().toLowerCase();
  const providerName = raw as ProviderName;
  
  if (currentProvider && currentProviderName === providerName) {
    return currentProvider;
  }

  // Close old provider if switching to a different one
  currentProvider?.close?.().catch(() => { /* ignore close errors */ });

  if (!providers[providerName]) {
    throw new Error(
      `Unknown LLM provider: "${providerName}". ` +
      `Valid options: ${Object.keys(providers).join(', ')}`
    );
  }

  const provider = providers[providerName]();
  
  if (!provider.isAvailable()) {
    logger.warn(
      `Provider "${providerName}" is not available (missing API key or config). ` +
      `Falling back to copilot provider.`
    );
    currentProvider = providers.copilot();
    currentProviderName = 'copilot';
    return currentProvider;
  }

  logger.info(`Using LLM provider: ${providerName} (model: ${provider.getDefaultModel()})`);
  currentProvider = provider;
  currentProviderName = providerName;
  return currentProvider;
}

/** Reset the cached provider (for testing) */
export async function resetProvider(): Promise<void> {
  try { await currentProvider?.close?.(); } catch { /* ignore close errors */ }
  currentProvider = null;
  currentProviderName = null;
}

/** Get the name of the current provider */
export function getProviderName(): ProviderName {
  const raw = (process.env.LLM_PROVIDER || 'copilot').trim().toLowerCase();
  const valid: ProviderName[] = ['copilot', 'openai', 'claude'];
  return currentProviderName ?? (valid.includes(raw as ProviderName) ? (raw as ProviderName) : 'copilot');
}

// Re-export types and providers
export type { LLMProvider, LLMSession, LLMResponse, SessionConfig, ToolWithHandler, TokenUsage, CostInfo, QuotaSnapshot, ProviderEvent, ProviderEventType } from './types.js';
export type { ProviderName } from './types.js';
export { CopilotProvider } from './CopilotProvider.js';
export { OpenAIProvider } from './OpenAIProvider.js';
export { ClaudeProvider } from './ClaudeProvider.js';
