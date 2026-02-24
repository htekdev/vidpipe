import { describe, it, expect } from 'vitest';

describe('Smoke Test', () => {
  it('should import environment config', async () => {
    const mod = await import('../../../L1-infra/config/environment.js');
    expect(mod).toBeDefined();
  });
});
