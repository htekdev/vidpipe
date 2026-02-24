/**
 * LLM Model Pricing Configuration
 * 
 * Per-model pricing for cost calculation. Updated Feb 2026.
 * Copilot uses Premium Request Units (PRUs), others use per-token pricing.
 */

export interface ModelPricing {
  /** Price per 1M input tokens (USD) — for OpenAI/Claude */
  inputPer1M?: number;
  /** Price per 1M output tokens (USD) — for OpenAI/Claude */
  outputPer1M?: number;
  /** Premium request multiplier — for Copilot */
  pruMultiplier?: number;
  /** Whether this model is included free on paid Copilot plans */
  copilotIncluded?: boolean;
}

/** Overage rate for Copilot premium requests: $0.04 per PRU */
export const COPILOT_PRU_OVERAGE_RATE = 0.04;

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // === OpenAI Models (from Copilot model picker) ===
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00, pruMultiplier: 0, copilotIncluded: true },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60, pruMultiplier: 0, copilotIncluded: true },
  'gpt-4.1': { inputPer1M: 2.00, outputPer1M: 8.00, pruMultiplier: 0, copilotIncluded: true },
  'gpt-4.1-mini': { inputPer1M: 0.40, outputPer1M: 1.60 },
  'gpt-5-mini': { inputPer1M: 0.15, outputPer1M: 0.60, pruMultiplier: 0, copilotIncluded: true },
  'gpt-5': { inputPer1M: 2.50, outputPer1M: 10.00, pruMultiplier: 1 },
  'gpt-5-codex': { inputPer1M: 2.50, outputPer1M: 10.00, pruMultiplier: 1 },
  'gpt-5.1': { inputPer1M: 2.50, outputPer1M: 10.00, pruMultiplier: 1 },
  'gpt-5.1-codex': { inputPer1M: 2.50, outputPer1M: 10.00, pruMultiplier: 1 },
  'gpt-5.1-codex-max': { inputPer1M: 2.50, outputPer1M: 10.00, pruMultiplier: 1 },
  'gpt-5.1-codex-mini': { inputPer1M: 0.15, outputPer1M: 0.60, pruMultiplier: 0.33 },
  'gpt-5.2': { inputPer1M: 2.50, outputPer1M: 10.00, pruMultiplier: 1 },
  'gpt-5.2-codex': { inputPer1M: 2.50, outputPer1M: 10.00, pruMultiplier: 1 },
  'o3': { inputPer1M: 10.00, outputPer1M: 40.00, pruMultiplier: 5 },
  'o4-mini-high': { inputPer1M: 1.10, outputPer1M: 4.40, pruMultiplier: 20 },

  // === Anthropic Models (from Copilot model picker) ===
  'claude-haiku-4.5': { inputPer1M: 0.80, outputPer1M: 4.00, pruMultiplier: 0.33 },
  'claude-sonnet-4': { inputPer1M: 3.00, outputPer1M: 15.00, pruMultiplier: 1 },
  'claude-sonnet-4.5': { inputPer1M: 3.00, outputPer1M: 15.00, pruMultiplier: 1 },
  'claude-opus-4.5': { inputPer1M: 15.00, outputPer1M: 75.00, pruMultiplier: 3 },
  'claude-opus-4.6': { inputPer1M: 5.00, outputPer1M: 25.00, pruMultiplier: 3 },
  'claude-opus-4.6-fast': { inputPer1M: 5.00, outputPer1M: 25.00, pruMultiplier: 9 },

  // === Google Models (from Copilot model picker) ===
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 5.00, pruMultiplier: 1 },
  'gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'gemini-3-flash': { inputPer1M: 0.10, outputPer1M: 0.40, pruMultiplier: 0.33 },
  'gemini-3-pro': { inputPer1M: 1.25, outputPer1M: 5.00, pruMultiplier: 1 },
};

/**
 * Calculate cost for a single LLM call using per-token pricing.
 * Returns USD amount.
 */
export function calculateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = getModelPricing(model);
  if (!pricing || (!pricing.inputPer1M && !pricing.outputPer1M)) return 0;
  
  const inputCost = ((pricing.inputPer1M ?? 0) / 1_000_000) * inputTokens;
  const outputCost = ((pricing.outputPer1M ?? 0) / 1_000_000) * outputTokens;
  return inputCost + outputCost;
}

/**
 * Calculate PRU cost for a Copilot premium request.
 * Returns PRU count consumed (multiply by $0.04 for overage cost).
 */
export function calculatePRUCost(model: string): number {
  const pricing = getModelPricing(model);
  if (!pricing) return 1; // Default 1 PRU for unknown models
  if (pricing.copilotIncluded) return 0; // Free on paid plans
  return pricing.pruMultiplier ?? 1;
}

/**
 * Look up model pricing. Returns undefined if model is unknown.
 */
export function getModelPricing(model: string): ModelPricing | undefined {
  // Try exact match first, then case-insensitive
  return MODEL_PRICING[model] ?? 
    MODEL_PRICING[model.toLowerCase()] ??
    Object.entries(MODEL_PRICING).find(([key]) => 
      model.toLowerCase().includes(key.toLowerCase())
    )?.[1];
}
