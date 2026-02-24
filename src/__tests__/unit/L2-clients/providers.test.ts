import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateTokenCost,
  calculatePRUCost,
  getModelPricing,
  COPILOT_PRU_OVERAGE_RATE,
} from '../../../L0-pure/pricing/pricing.js';
import { costTracker } from '../../../L3-services/costTracking/costTracker.js';
import { getProvider, getProviderName, resetProvider } from '../../../L2-clients/llm/index.js';
import { CopilotProvider } from '../../../L2-clients/llm/CopilotProvider.js';
import { initConfig } from '../../../L1-infra/config/environment.js';
import { Platform, toLatePlatform, fromLatePlatform, normalizePlatformString } from '../../../L0-pure/types/index.js';

// ─── pricing.ts ───────────────────────────────────────────────

describe('calculateTokenCost', () => {
  it('returns correct cost for a known model (gpt-4o)', () => {
    // gpt-4o: inputPer1M=2.50, outputPer1M=10.00
    const cost = calculateTokenCost('gpt-4o', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(12.50);
  });

  it('returns 0 for an unknown model', () => {
    expect(calculateTokenCost('nonexistent-model', 500, 500)).toBe(0);
  });

  it('resolves versioned model names via fuzzy matching', () => {
    // claude-sonnet-4-20250514 should match claude-sonnet-4
    const cost = calculateTokenCost('claude-sonnet-4-20250514', 1000, 500);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeCloseTo(calculateTokenCost('claude-sonnet-4', 1000, 500));
  });

  it('handles model with only inputPer1M set', () => {
    // All models in the table have both, so unknown returns 0
    const cost = calculateTokenCost('gpt-4o', 1000, 0);
    expect(cost).toBeCloseTo(0.0025);
  });
});

describe('calculatePRUCost', () => {
  it('returns correct multiplier for a copilot model with pruMultiplier', () => {
    // claude-sonnet-4 has pruMultiplier: 1
    expect(calculatePRUCost('claude-sonnet-4')).toBe(1);
  });

  it('returns 0 for a copilotIncluded model', () => {
    // gpt-4o has copilotIncluded: true
    expect(calculatePRUCost('gpt-4o')).toBe(0);
  });

  it('returns 1 (default) for an unknown model', () => {
    expect(calculatePRUCost('nonexistent-model')).toBe(1);
  });

  it('resolves versioned model names via fuzzy matching', () => {
    // claude-sonnet-4-20250514 should match claude-sonnet-4 (pruMultiplier: 1)
    expect(calculatePRUCost('claude-sonnet-4-20250514')).toBe(1);
  });

  it('returns pruMultiplier for high-cost model', () => {
    // o3 has pruMultiplier: 5
    expect(calculatePRUCost('o3')).toBe(5);
  });

  it('returns pruMultiplier for claude-haiku-4.5', () => {
    // claude-haiku-4.5 has pruMultiplier: 0.33
    expect(calculatePRUCost('claude-haiku-4.5')).toBe(0.33);
  });

  it('defaults to 1 PRU when pruMultiplier is undefined', () => {
    // gpt-4.1-mini has pricing but no pruMultiplier and no copilotIncluded
    expect(calculatePRUCost('gpt-4.1-mini')).toBe(1);
  });

  it('defaults to 1 PRU for gemini-2.5-flash (no pruMultiplier)', () => {
    expect(calculatePRUCost('gemini-2.5-flash')).toBe(1);
  });
});

describe('getModelPricing', () => {
  it('returns pricing for a known model', () => {
    const pricing = getModelPricing('gpt-4o');
    expect(pricing).toBeDefined();
    expect(pricing!.inputPer1M).toBe(2.5);
    expect(pricing!.outputPer1M).toBe(10.0);
  });

  it('returns undefined for a completely unknown model', () => {
    expect(getModelPricing('nonexistent-model-xyz')).toBeUndefined();
  });

  it('matches case-insensitively', () => {
    const pricing = getModelPricing('GPT-4O');
    expect(pricing).toBeDefined();
  });

  it('matches partial model name', () => {
    // 'my-gpt-4o-deployment' includes 'gpt-4o'
    const pricing = getModelPricing('my-gpt-4o-deployment');
    expect(pricing).toBeDefined();
  });
});

describe('COPILOT_PRU_OVERAGE_RATE', () => {
  it('equals $0.04', () => {
    expect(COPILOT_PRU_OVERAGE_RATE).toBe(0.04);
  });
});

// ─── costTracker.ts ───────────────────────────────────────────

describe('CostTracker', () => {
  beforeEach(() => {
    costTracker.reset();
  });

  const makeUsage = (input = 100, output = 50) => ({
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
  });

  it('recordUsage stores a record and getReport returns it', () => {
    costTracker.recordUsage('openai', 'gpt-4o', makeUsage());
    const report = costTracker.getReport();
    expect(report.records).toHaveLength(1);
    expect(report.records[0].provider).toBe('openai');
    expect(report.records[0].model).toBe('gpt-4o');
  });

  it('recordUsage with copilot provider uses PRU cost', () => {
    costTracker.recordUsage('copilot', 'claude-sonnet-4', makeUsage());
    const record = costTracker.getReport().records[0];
    expect(record.cost.unit).toBe('premium_requests');
    expect(record.cost.amount).toBe(calculatePRUCost('claude-sonnet-4'));
  });

  it('recordUsage with openai provider uses token cost', () => {
    costTracker.recordUsage('openai', 'gpt-4o', makeUsage(1000, 500));
    const record = costTracker.getReport().records[0];
    expect(record.cost.unit).toBe('usd');
    expect(record.cost.amount).toBeCloseTo(
      calculateTokenCost('gpt-4o', 1000, 500),
    );
  });

  it('getReport aggregates totals correctly with multiple records', () => {
    costTracker.recordUsage('openai', 'gpt-4o', makeUsage(100, 50));
    costTracker.recordUsage('openai', 'gpt-4o', makeUsage(200, 100));
    const report = costTracker.getReport();
    expect(report.totalTokens.input).toBe(300);
    expect(report.totalTokens.output).toBe(150);
    expect(report.totalTokens.total).toBe(450);
    expect(report.records).toHaveLength(2);
  });

  it('getReport aggregates by provider, agent, and model', () => {
    costTracker.setAgent('AgentA');
    costTracker.recordUsage('openai', 'gpt-4o', makeUsage());
    costTracker.setAgent('AgentB');
    costTracker.recordUsage('copilot', 'claude-sonnet-4', makeUsage());
    const report = costTracker.getReport();
    expect(report.byProvider['openai'].calls).toBe(1);
    expect(report.byProvider['copilot'].calls).toBe(1);
    expect(report.byAgent['AgentA'].calls).toBe(1);
    expect(report.byAgent['AgentB'].calls).toBe(1);
    expect(report.byModel['gpt-4o'].calls).toBe(1);
    expect(report.byModel['claude-sonnet-4'].calls).toBe(1);
  });

  it('getReport computes PRU costs as USD via overage rate', () => {
    costTracker.recordUsage('copilot', 'o3', makeUsage());
    const report = costTracker.getReport();
    // o3 has pruMultiplier 5 → totalPRUs = 5, totalCostUSD = 5 * 0.04
    expect(report.totalPRUs).toBe(5);
    expect(report.totalCostUSD).toBeCloseTo(5 * COPILOT_PRU_OVERAGE_RATE);
  });

  it('formatReport returns a non-empty string', () => {
    costTracker.recordUsage('openai', 'gpt-4o', makeUsage());
    const text = costTracker.formatReport();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('Cost Report');
  });

  it('formatReport includes PRU line when PRUs > 0', () => {
    costTracker.recordUsage('copilot', 'o3', makeUsage());
    const text = costTracker.formatReport();
    expect(text).toContain('premium requests');
  });

  it('formatReport includes agent/model breakdown with multiple entries', () => {
    costTracker.setAgent('A');
    costTracker.recordUsage('openai', 'gpt-4o', makeUsage());
    costTracker.setAgent('B');
    costTracker.recordUsage('openai', 'gpt-4o-mini', makeUsage());
    const text = costTracker.formatReport();
    expect(text).toContain('By Agent');
    expect(text).toContain('By Model');
  });

  it('reset clears all records', () => {
    costTracker.recordUsage('openai', 'gpt-4o', makeUsage());
    costTracker.reset();
    const report = costTracker.getReport();
    expect(report.records).toHaveLength(0);
    expect(report.totalCostUSD).toBe(0);
  });

  it('setAgent and setStage affect recorded records', () => {
    costTracker.setAgent('MyAgent');
    costTracker.setStage('transcribe');
    costTracker.recordUsage('openai', 'gpt-4o', makeUsage());
    const record = costTracker.getReport().records[0];
    expect(record.agent).toBe('MyAgent');
    expect(record.stage).toBe('transcribe');
  });

  it('recordUsage stores quota snapshot when provided', () => {
    const quota = {
      isUnlimitedEntitlement: false,
      entitlementRequests: 100,
      usedRequests: 40,
      remainingPercentage: 60,
      resetDate: '2026-03-01',
      overage: 0,
    };
    costTracker.recordUsage('copilot', 'gpt-4o', makeUsage(), undefined, undefined, quota);
    const report = costTracker.getReport();
    expect(report.copilotQuota).toEqual(quota);
  });

  it('formatReport includes quota info when available', () => {
    const quota = {
      isUnlimitedEntitlement: false,
      entitlementRequests: 100,
      usedRequests: 40,
      remainingPercentage: 60,
      resetDate: '2026-03-01',
      overage: 0,
    };
    costTracker.recordUsage('copilot', 'gpt-4o', makeUsage(), undefined, undefined, quota);
    const text = costTracker.formatReport();
    expect(text).toContain('Copilot Quota');
    expect(text).toContain('Resets');
  });

  it('recordUsage accepts explicit cost, skipping auto-calculation', () => {
    const explicitCost = { amount: 42, unit: 'usd' as const, model: 'gpt-4o' };
    costTracker.recordUsage('openai', 'gpt-4o', makeUsage(), explicitCost);
    const record = costTracker.getReport().records[0];
    expect(record.cost.amount).toBe(42);
  });

  it('costTracker records durationMs when provided', () => {
    costTracker.reset();
    costTracker.recordUsage('claude', 'claude-opus-4.6', makeUsage(), undefined, 1500);
    const report = costTracker.getReport();
    expect(report.records[0].durationMs).toBe(1500);
  });

  it('costTracker handles missing durationMs gracefully', () => {
    costTracker.reset();
    costTracker.recordUsage('claude', 'claude-opus-4.6', makeUsage());
    const report = costTracker.getReport();
    expect(report.records[0].durationMs).toBeUndefined();
  });
});

// ─── provider timeout contract ────────────────────────────────

describe('provider timeout contract', () => {
  it('OpenAIProvider class exists and has createSession', async () => {
    const { OpenAIProvider } = await import('../../../L2-clients/llm/OpenAIProvider.js');
    expect(typeof OpenAIProvider).toBe('function');
    const provider = new OpenAIProvider();
    expect(typeof provider.createSession).toBe('function');
  });

  it('ClaudeProvider class exists and has createSession', async () => {
    const { ClaudeProvider } = await import('../../../L2-clients/llm/ClaudeProvider.js');
    expect(typeof ClaudeProvider).toBe('function');
    const provider = new ClaudeProvider();
    expect(typeof provider.createSession).toBe('function');
  });

  it('SessionConfig type includes timeoutMs (structural check via providers)', () => {
    // Both providers accept SessionConfig which includes timeoutMs.
    // This test verifies the type contract compiles correctly — if timeoutMs
    // were removed from SessionConfig, the providers would fail to compile.
    const config: import('../../../L2-clients/llm/types.js').SessionConfig = {
      systemPrompt: 'test',
      tools: [],
      timeoutMs: 5000,
    };
    expect(config.timeoutMs).toBe(5000);
  });

  it('LLMResponse type includes durationMs field', () => {
    const response: import('../../../L2-clients/llm/types.js').LLMResponse = {
      content: 'test',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      durationMs: 123,
    };
    expect(response.durationMs).toBe(123);
  });
});

describe('providers/index', () => {
  beforeEach(async () => {
    await resetProvider();
    delete process.env.LLM_PROVIDER;
    initConfig();
  });

  afterEach(async () => {
    await resetProvider();
    delete process.env.LLM_PROVIDER;
    initConfig();
  });

  it('getProvider() returns CopilotProvider by default', () => {
    const provider = getProvider();
    expect(provider).toBeInstanceOf(CopilotProvider);
  });

  it('getProvider("copilot") returns CopilotProvider', () => {
    const provider = getProvider('copilot');
    expect(provider).toBeInstanceOf(CopilotProvider);
  });

  it('getProvider caches the provider instance', () => {
    const a = getProvider('copilot');
    const b = getProvider('copilot');
    expect(a).toBe(b);
  });

  it('getProviderName() returns copilot by default', () => {
    expect(getProviderName()).toBe('copilot');
  });

  it('getProviderName() returns name after getProvider is called', () => {
    getProvider('copilot');
    expect(getProviderName()).toBe('copilot');
  });

  it('resetProvider() clears cached provider', async () => {
    const a = getProvider('copilot');
    await resetProvider();
    // After reset, getProviderName falls back to env or default
    expect(getProviderName()).toBe('copilot');
    const b = getProvider('copilot');
    // New instance after reset
    expect(a).not.toBe(b);
  });

  it('getProvider throws for unknown provider name', () => {
    expect(() => getProvider('nonexistent' as any)).toThrow('Unknown LLM provider');
  });

  it('getProvider falls back to copilot when provider is not available', async () => {
    // OpenAI without OPENAI_API_KEY → isAvailable() returns false → fallback to copilot
    delete process.env.OPENAI_API_KEY;
    initConfig();
    await resetProvider();
    const provider = getProvider('openai');
    expect(provider).toBeInstanceOf(CopilotProvider);
  });

  it('getProvider closes old provider when switching', async () => {
    const first = getProvider('copilot');
    const closeSpy = vi.fn().mockResolvedValue(undefined);
    first.close = closeSpy;
    await resetProvider();
    // Switch to a new provider
    getProvider('copilot');
    // resetProvider calls close
    expect(closeSpy).toHaveBeenCalled();
  });

  it('getProviderName reads LLM_PROVIDER env var', async () => {
    process.env.LLM_PROVIDER = 'openai';
    initConfig();
    await resetProvider();
    expect(getProviderName()).toBe('openai');
  });

  it('getProviderName returns copilot for invalid LLM_PROVIDER values', async () => {
    process.env.LLM_PROVIDER = 'invalid-provider';
    initConfig();
    await resetProvider();
    expect(getProviderName()).toBe('copilot');
  });

  it('resetProvider awaits close and handles rejection gracefully', async () => {
    // Get a provider so one is cached
    const provider = getProvider();

    // Mock close to reject
    const originalClose = provider.close?.bind(provider);
    provider.close = async () => { throw new Error('close failed'); };

    // resetProvider should NOT throw even if close rejects
    await expect(resetProvider()).resolves.not.toThrow();

    // Restore
    provider.close = originalClose;
  });
});

// ─── toLatePlatform / fromLatePlatform ─────────────────────────

describe('toLatePlatform', () => {
  it('maps Platform.X to twitter', () => {
    expect(toLatePlatform(Platform.X)).toBe('twitter');
  });

  it('passes other platforms through unchanged', () => {
    expect(toLatePlatform(Platform.YouTube)).toBe('youtube');
    expect(toLatePlatform(Platform.TikTok)).toBe('tiktok');
    expect(toLatePlatform(Platform.Instagram)).toBe('instagram');
    expect(toLatePlatform(Platform.LinkedIn)).toBe('linkedin');
  });
});

describe('fromLatePlatform', () => {
  it('maps twitter to Platform.X', () => {
    expect(fromLatePlatform('twitter')).toBe(Platform.X);
  });

  it('passes other platform strings through as-is', () => {
    expect(fromLatePlatform('youtube')).toBe(Platform.YouTube);
    expect(fromLatePlatform('tiktok')).toBe(Platform.TikTok);
  });

  it('throws for unsupported platform', () => {
    expect(() => fromLatePlatform('fakebook')).toThrow('Unsupported platform from Late API: fakebook');
  });
});

describe('normalizePlatformString', () => {
  it('normalizes X variants to twitter', () => {
    expect(normalizePlatformString('X')).toBe('twitter');
    expect(normalizePlatformString('x')).toBe('twitter');
    expect(normalizePlatformString('X (Twitter)')).toBe('twitter');
    expect(normalizePlatformString('x (twitter)')).toBe('twitter');
    expect(normalizePlatformString('X/Twitter')).toBe('twitter');
    expect(normalizePlatformString('x/twitter')).toBe('twitter');
  });

  it('normalizes other platform names to lowercase', () => {
    expect(normalizePlatformString('YouTube')).toBe('youtube');
    expect(normalizePlatformString('TIKTOK')).toBe('tiktok');
    expect(normalizePlatformString('Instagram')).toBe('instagram');
    expect(normalizePlatformString('LinkedIn')).toBe('linkedin');
  });

  it('handles whitespace', () => {
    expect(normalizePlatformString(' youtube ')).toBe('youtube');
    expect(normalizePlatformString('  x  ')).toBe('twitter');
  });
});
