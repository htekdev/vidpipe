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
  SocialMediaAgent: STANDARD_MODEL,
  BlogAgent: STANDARD_MODEL,
  SummaryAgent: FREE_MODEL,
  ChapterAgent: FREE_MODEL,
  ShortPostsAgent: FREE_MODEL,
  MediumClipPostsAgent: FREE_MODEL,
};

/**
 * Resolve model for an agent. Priority:
 * 1. MODEL_<AGENT_NAME_UPPER> env var
 * 2. AGENT_MODEL_MAP entry
 * 3. Global LLM_MODEL env var
 * 4. undefined (provider default)
 */
export function getModelForAgent(agentName: string): string | undefined {
  // Per-agent env override (dynamic keys like MODEL_SHORTS_AGENT)
  const envKey = `MODEL_${agentName.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`;
  const envOverride = process.env[envKey];
  if (envOverride) return envOverride;

  const mapped = AGENT_MODEL_MAP[agentName];
  if (mapped) return mapped;

  const global = getConfig().LLM_MODEL;
  if (global) return global;

  return undefined;
}
