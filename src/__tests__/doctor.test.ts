import { describe, it, expect } from 'vitest';
import { normalizeProviderName } from '../commands/doctor.js';

describe('normalizeProviderName', () => {
  it('lowercases uppercase provider names', () => {
    expect(normalizeProviderName('OpenAI')).toBe('openai');
  });

  it('trims whitespace from provider names', () => {
    expect(normalizeProviderName('  claude  ')).toBe('claude');
  });

  it('handles mixed case and whitespace', () => {
    expect(normalizeProviderName(' Copilot ')).toBe('copilot');
  });

  it('defaults to copilot when undefined', () => {
    expect(normalizeProviderName(undefined)).toBe('copilot');
  });

  it('defaults to copilot when empty string', () => {
    expect(normalizeProviderName('')).toBe('copilot');
  });
});
