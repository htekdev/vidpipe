/**
 * Per-Agent Model Selection
 *
 * Central config for which LLM model each agent should use.
 * Override any agent via env var MODEL_<AGENT_NAME_UPPER> or globally via LLM_MODEL.
 */

import { getConfig } from './environment.js';

export const PREMIUM_MODEL = 'claude-opus-4.5';
export const STANDARD_MODEL = 'claude-sonnet-4.5';
export const FREE_MODEL = 'gpt-4.1';

export const AGENT_MODEL_MAP: Record<string, string> = {
  SilenceRemovalAgent: PREMIUM_MODEL,
  ShortsAgent: PREMIUM_MODEL,
  MediumVideoAgent: PREMIUM_MODEL,
  SocialMediaAgent: PREMIUM_MODEL,
  BlogAgent: PREMIUM_MODEL,
  SummaryAgent: PREMIUM_MODEL,
  IdeationAgent: PREMIUM_MODEL,
  ChapterAgent: PREMIUM_MODEL,
  ShortPostsAgent: PREMIUM_MODEL,
  MediumClipPostsAgent: PREMIUM_MODEL,
  ProducerAgent: PREMIUM_MODEL,
};

/**
 * Resolve model for an agent. Priority:
 * 1. MODEL_OVERRIDES from resolved config (populated from MODEL_* env vars)
 * 2. AGENT_MODEL_MAP entry
 * 3. Global LLM_MODEL from config
 * 4. undefined (provider default)
 */
export function getModelForAgent(agentName: string): string | undefined {
  const config = getConfig();

  // Per-agent override from resolved config (e.g. MODEL_SHORTS_AGENT=gpt-4o)
  const envKey = `MODEL_${agentName.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`;
  const envOverride = config.MODEL_OVERRIDES[envKey];
  if (envOverride) return envOverride;

  const mapped = AGENT_MODEL_MAP[agentName];
  if (mapped) return mapped;

  const global = config.LLM_MODEL;
  if (global) return global;

  return undefined;
}
