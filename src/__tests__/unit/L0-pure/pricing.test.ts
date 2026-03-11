import { describe, it, expect } from 'vitest'
import {
  calculateTokenCost,
  calculatePRUCost,
  getModelPricing,
  MODEL_PRICING,
  COPILOT_PRU_OVERAGE_RATE,
} from '../../../L0-pure/pricing/pricing.js'

// ---------------------------------------------------------------------------
// getModelPricing
// ---------------------------------------------------------------------------

describe('getModelPricing', () => {
  it('returns pricing for exact model name', () => {
    const pricing = getModelPricing('gpt-4o')
    expect(pricing).toBeDefined()
    expect(pricing!.inputPer1M).toBe(2.5)
    expect(pricing!.outputPer1M).toBe(10.0)
  })

  it('returns pricing for case-insensitive match', () => {
    const pricing = getModelPricing('GPT-4O')
    expect(pricing).toBeDefined()
    expect(pricing!.inputPer1M).toBe(2.5)
  })

  it('returns pricing via substring match', () => {
    // "claude-sonnet-4" should match even with extra prefix/suffix
    const pricing = getModelPricing('some-claude-sonnet-4-variant')
    expect(pricing).toBeDefined()
  })

  it('returns undefined for completely unknown model', () => {
    const pricing = getModelPricing('nonexistent-model-xyz')
    expect(pricing).toBeUndefined()
  })

  it('returns pricing for Anthropic models', () => {
    const pricing = getModelPricing('claude-opus-4.5')
    expect(pricing).toBeDefined()
    expect(pricing!.inputPer1M).toBe(15.0)
    expect(pricing!.outputPer1M).toBe(75.0)
  })

  it('returns pricing for Google models', () => {
    const pricing = getModelPricing('gemini-2.5-pro')
    expect(pricing).toBeDefined()
    expect(pricing!.inputPer1M).toBe(1.25)
  })
})

// ---------------------------------------------------------------------------
// calculateTokenCost
// ---------------------------------------------------------------------------

describe('calculateTokenCost', () => {
  it('calculates cost for known model with both input and output tokens', () => {
    // gpt-4o: $2.50/1M input, $10.00/1M output
    const cost = calculateTokenCost('gpt-4o', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(12.5)
  })

  it('calculates cost proportionally for smaller token counts', () => {
    // gpt-4o: $2.50/1M input, $10.00/1M output
    const cost = calculateTokenCost('gpt-4o', 1000, 500)
    const expected = (2.5 / 1_000_000) * 1000 + (10.0 / 1_000_000) * 500
    expect(cost).toBeCloseTo(expected)
  })

  it('returns 0 for zero tokens', () => {
    const cost = calculateTokenCost('gpt-4o', 0, 0)
    expect(cost).toBe(0)
  })

  it('returns 0 for unknown model', () => {
    const cost = calculateTokenCost('nonexistent-model-xyz', 1000, 1000)
    expect(cost).toBe(0)
  })

  it('handles input-only cost', () => {
    const cost = calculateTokenCost('gpt-4o', 1_000_000, 0)
    expect(cost).toBeCloseTo(2.5)
  })

  it('handles output-only cost', () => {
    const cost = calculateTokenCost('gpt-4o', 0, 1_000_000)
    expect(cost).toBeCloseTo(10.0)
  })

  it('calculates correct cost for claude-opus-4.5 (expensive model)', () => {
    // claude-opus-4.5: $15.00/1M input, $75.00/1M output
    const cost = calculateTokenCost('claude-opus-4.5', 100_000, 50_000)
    const expected = (15.0 / 1_000_000) * 100_000 + (75.0 / 1_000_000) * 50_000
    expect(cost).toBeCloseTo(expected)
  })

  it('calculates correct cost for cheap model (gpt-4o-mini)', () => {
    // gpt-4o-mini: $0.15/1M input, $0.60/1M output
    const cost = calculateTokenCost('gpt-4o-mini', 10_000, 5_000)
    const expected = (0.15 / 1_000_000) * 10_000 + (0.60 / 1_000_000) * 5_000
    expect(cost).toBeCloseTo(expected)
  })
})

// ---------------------------------------------------------------------------
// calculatePRUCost
// ---------------------------------------------------------------------------

describe('calculatePRUCost', () => {
  it('returns 0 for Copilot-included models', () => {
    // gpt-4o has copilotIncluded: true
    expect(calculatePRUCost('gpt-4o')).toBe(0)
    expect(calculatePRUCost('gpt-4o-mini')).toBe(0)
  })

  it('returns PRU multiplier for premium models', () => {
    // o3 has pruMultiplier: 5
    expect(calculatePRUCost('o3')).toBe(5)
  })

  it('returns 1 for unknown models (default)', () => {
    expect(calculatePRUCost('nonexistent-model-xyz')).toBe(1)
  })

  it('returns fractional PRU for efficient models', () => {
    // claude-haiku-4.5 has pruMultiplier: 0.33
    expect(calculatePRUCost('claude-haiku-4.5')).toBe(0.33)
  })

  it('returns correct PRU for claude-sonnet-4', () => {
    expect(calculatePRUCost('claude-sonnet-4')).toBe(1)
  })

  it('returns correct PRU for claude-opus-4.5', () => {
    expect(calculatePRUCost('claude-opus-4.5')).toBe(3)
  })

  it('returns high PRU for o4-mini-high', () => {
    expect(calculatePRUCost('o4-mini-high')).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('pricing constants', () => {
  it('COPILOT_PRU_OVERAGE_RATE is $0.04', () => {
    expect(COPILOT_PRU_OVERAGE_RATE).toBe(0.04)
  })

  it('MODEL_PRICING contains OpenAI, Anthropic, and Google models', () => {
    const keys = Object.keys(MODEL_PRICING)
    expect(keys.some(k => k.startsWith('gpt'))).toBe(true)
    expect(keys.some(k => k.startsWith('claude'))).toBe(true)
    expect(keys.some(k => k.startsWith('gemini'))).toBe(true)
  })

  it('all models have at least inputPer1M or pruMultiplier', () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      const hasTokenPricing = pricing.inputPer1M !== undefined
      const hasPRU = pricing.pruMultiplier !== undefined
      const isFree = pricing.copilotIncluded === true
      expect(
        hasTokenPricing || hasPRU || isFree,
      ).toBe(true)
    }
  })
})
