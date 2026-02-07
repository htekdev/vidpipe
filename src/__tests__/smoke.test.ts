import { describe, it, expect } from 'vitest';

describe('Smoke Test', () => {
  it('should import environment config', async () => {
    const mod = await import('../config/environment.js');
    expect(mod).toBeDefined();
  });
});
