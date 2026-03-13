import { describe, it, expect, vi } from 'vitest';

// Mock L1 dependencies that migrate.ts needs at import time
vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: vi.fn(),
  getConfig: vi.fn().mockReturnValue({ OUTPUT_DIR: '/tmp' }),
}));
vi.mock('../../../L1-infra/database/index.js', () => ({
  initializeDatabase: vi.fn(),
}));

describe('Smoke Test', () => {
  it('should import environment config', async () => {
    const mod = await import('../../../L1-infra/config/environment.js');
    expect(mod).toBeDefined();
  });

  it('should export runMigrate from commands/migrate', async () => {
    const mod = await import('../../../L7-app/commands/migrate.js');
    expect(mod.runMigrate).toBeDefined();
    expect(typeof mod.runMigrate).toBe('function');
  });
});
