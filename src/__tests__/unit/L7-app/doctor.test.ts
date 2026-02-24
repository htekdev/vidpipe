import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist all mocks so they can be referenced in vi.mock factories
const {
  mockSpawnSync,
  mockExistsSync,
  mockGetConfig,
  mockValidateConnection,
  mockListAccounts,
  mockLoadScheduleConfig,
} = vi.hoisted(() => ({
  mockSpawnSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockGetConfig: vi.fn(),
  mockValidateConnection: vi.fn(),
  mockListAccounts: vi.fn(),
  mockLoadScheduleConfig: vi.fn(),
}));

vi.mock('child_process', () => ({ spawnSync: mockSpawnSync }));
vi.mock('fs', async (importOriginal) => {
  const orig = await importOriginal() as any;
  return { ...orig, existsSync: mockExistsSync };
});
vi.mock('../../../L1-infra/config/environment.js', () => ({ getConfig: mockGetConfig }));
vi.mock('../../../L3-services/lateApi/lateApiService.js', () => ({
  createLateApiClient: (...args: unknown[]) => ({
    validateConnection: (...a: unknown[]) => mockValidateConnection(...a),
    listAccounts: (...a: unknown[]) => mockListAccounts(...a),
  }),
}));
vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: mockLoadScheduleConfig,
}));

import { normalizeProviderName, runDoctor } from '../../../L7-app/commands/doctor.js';

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

describe('runDoctor', () => {
  let mockProcessExit: ReturnType<typeof vi.fn>;
  let mockConsoleLog: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessExit = vi.fn().mockImplementation(() => { throw new Error('process.exit'); });
    mockConsoleLog = vi.fn();
    vi.spyOn(process, 'exit').mockImplementation(mockProcessExit as any);
    vi.spyOn(console, 'log').mockImplementation(mockConsoleLog as (...args: any[]) => void);

    // Default: all checks pass
    mockGetConfig.mockReturnValue({
      FFMPEG_PATH: 'ffmpeg',
      FFPROBE_PATH: 'ffprobe',
      OPENAI_API_KEY: 'sk-test-key',
      EXA_API_KEY: '',
      WATCH_FOLDER: '',
      LLM_PROVIDER: undefined,
      LLM_MODEL: undefined,
      ANTHROPIC_API_KEY: undefined,
      LATE_API_KEY: '',
    });
    // All spawn calls succeed (ffmpeg-static/ffprobe-installer resolve via real createRequire)
    mockSpawnSync.mockReturnValue({ status: 0, stdout: 'version 6.1.1' });
    mockExistsSync.mockReturnValue(true);
    mockValidateConnection.mockResolvedValue({ valid: true, profileName: 'TestProfile' });
    mockListAccounts.mockResolvedValue([]);
    mockLoadScheduleConfig.mockResolvedValue({ platforms: { tiktok: {}, youtube: {} } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function getLogs(): string {
    return mockConsoleLog.mock.calls.map((c: any) => c[0]).join('\n');
  }

  it('passes when all checks succeed with copilot provider', async () => {
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(mockProcessExit).toHaveBeenCalledWith(0);
    expect(getLogs()).toContain('Copilot');
  });

  it('fails when FFmpeg is not found', async () => {
    mockSpawnSync.mockImplementation((cmd: string) => {
      if (cmd === 'git') return { status: 0, stdout: 'git version 2.43.0' };
      throw new Error('not found');
    });
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it('fails when OPENAI_API_KEY is not set', async () => {
    mockGetConfig.mockReturnValue({
      FFMPEG_PATH: 'ffmpeg', FFPROBE_PATH: 'ffprobe',
      OPENAI_API_KEY: '', EXA_API_KEY: '', WATCH_FOLDER: '',
      LLM_PROVIDER: undefined, LLM_MODEL: undefined, ANTHROPIC_API_KEY: undefined, LATE_API_KEY: '',
    });
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(getLogs()).toContain('OPENAI_API_KEY not set');
  });

  it('reports unknown provider', async () => {
    mockGetConfig.mockReturnValue({
      FFMPEG_PATH: 'ffmpeg', FFPROBE_PATH: 'ffprobe',
      OPENAI_API_KEY: 'sk-test', EXA_API_KEY: '', WATCH_FOLDER: '',
      LLM_PROVIDER: 'invalid', LLM_MODEL: undefined, ANTHROPIC_API_KEY: undefined, LATE_API_KEY: '',
    });
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('unknown provider');
  });

  it('reports missing OPENAI_API_KEY for openai provider', async () => {
    mockGetConfig.mockReturnValue({
      FFMPEG_PATH: 'ffmpeg', FFPROBE_PATH: 'ffprobe',
      OPENAI_API_KEY: '', EXA_API_KEY: '', WATCH_FOLDER: '',
      LLM_PROVIDER: 'openai', LLM_MODEL: undefined, ANTHROPIC_API_KEY: undefined, LATE_API_KEY: '',
    });
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('OPENAI_API_KEY not set');
  });

  it('reports missing ANTHROPIC_API_KEY for claude provider', async () => {
    mockGetConfig.mockReturnValue({
      FFMPEG_PATH: 'ffmpeg', FFPROBE_PATH: 'ffprobe',
      OPENAI_API_KEY: 'sk-test', EXA_API_KEY: '', WATCH_FOLDER: '',
      LLM_PROVIDER: 'claude', LLM_MODEL: undefined, ANTHROPIC_API_KEY: undefined, LATE_API_KEY: '',
    });
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('ANTHROPIC_API_KEY not set');
  });

  it('shows model override when LLM_MODEL is set', async () => {
    mockGetConfig.mockReturnValue({
      FFMPEG_PATH: 'ffmpeg', FFPROBE_PATH: 'ffprobe',
      OPENAI_API_KEY: 'sk-test', EXA_API_KEY: '', WATCH_FOLDER: '',
      LLM_PROVIDER: undefined, LLM_MODEL: 'gpt-4o-mini', ANTHROPIC_API_KEY: undefined, LATE_API_KEY: '',
    });
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('Model override');
    expect(getLogs()).toContain('gpt-4o-mini');
  });

  it('reports EXA_API_KEY as optional when missing', async () => {
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('EXA_API_KEY not set (optional');
  });

  it('reports watch folder missing', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (typeof p === 'string' && (p.includes('watch') || p.includes('Watch'))) return false;
      return true;
    });
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('Watch folder missing');
  });

  it('handles Late API key not configured', async () => {
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('Late API key: not configured');
  });

  it('handles Late API key invalid', async () => {
    mockGetConfig.mockReturnValue({
      FFMPEG_PATH: 'ffmpeg', FFPROBE_PATH: 'ffprobe',
      OPENAI_API_KEY: 'sk-test', EXA_API_KEY: '', WATCH_FOLDER: '',
      LLM_PROVIDER: undefined, LLM_MODEL: undefined, ANTHROPIC_API_KEY: undefined,
      LATE_API_KEY: 'bad-key',
    });
    mockValidateConnection.mockResolvedValue({ valid: false, error: 'bad token' });
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('Late API key: invalid');
  });

  it('handles Late API connected with accounts', async () => {
    mockGetConfig.mockReturnValue({
      FFMPEG_PATH: 'ffmpeg', FFPROBE_PATH: 'ffprobe',
      OPENAI_API_KEY: 'sk-test', EXA_API_KEY: '', WATCH_FOLDER: '',
      LLM_PROVIDER: undefined, LLM_MODEL: undefined, ANTHROPIC_API_KEY: undefined,
      LATE_API_KEY: 'valid-key',
    });
    mockValidateConnection.mockResolvedValue({ valid: true, profileName: 'TestProfile' });
    mockListAccounts.mockResolvedValue([
      { platform: 'tiktok', username: 'test', displayName: 'Test' },
      { platform: 'youtube', username: '', displayName: 'MyChannel' },
    ]);
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('connected to profile');
    expect(getLogs()).toContain('TikTok');
  });

  it('handles Late API with no accounts', async () => {
    mockGetConfig.mockReturnValue({
      FFMPEG_PATH: 'ffmpeg', FFPROBE_PATH: 'ffprobe',
      OPENAI_API_KEY: 'sk-test', EXA_API_KEY: '', WATCH_FOLDER: '',
      LLM_PROVIDER: undefined, LLM_MODEL: undefined, ANTHROPIC_API_KEY: undefined,
      LATE_API_KEY: 'valid-key',
    });
    mockValidateConnection.mockResolvedValue({ valid: true, profileName: 'TestProfile' });
    mockListAccounts.mockResolvedValue([]);
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('No social accounts connected');
  });

  it('handles Late API network error', async () => {
    mockGetConfig.mockReturnValue({
      FFMPEG_PATH: 'ffmpeg', FFPROBE_PATH: 'ffprobe',
      OPENAI_API_KEY: 'sk-test', EXA_API_KEY: '', WATCH_FOLDER: '',
      LLM_PROVIDER: undefined, LLM_MODEL: undefined, ANTHROPIC_API_KEY: undefined,
      LATE_API_KEY: 'valid-key',
    });
    mockValidateConnection.mockRejectedValue(new Error('network error'));
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('could not connect');
  });

  it('handles schedule config not found', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (typeof p === 'string' && p.includes('schedule.json')) return false;
      return true;
    });
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('schedule.json not found');
  });

  it('handles invalid schedule config', async () => {
    mockLoadScheduleConfig.mockRejectedValue(new Error('Invalid JSON'));
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('schedule.json invalid');
  });

  it('resolves FFmpeg from custom FFMPEG_PATH config', async () => {
    mockGetConfig.mockReturnValue({
      FFMPEG_PATH: '/custom/ffmpeg', FFPROBE_PATH: 'ffprobe',
      OPENAI_API_KEY: 'sk-test', EXA_API_KEY: '', WATCH_FOLDER: '',
      LLM_PROVIDER: undefined, LLM_MODEL: undefined, ANTHROPIC_API_KEY: undefined, LATE_API_KEY: '',
    });
    mockSpawnSync.mockImplementation((cmd: string) => {
      if (cmd === '/custom/ffmpeg') return { status: 0, stdout: 'ffmpeg version 7.0' };
      if (cmd === 'git') return { status: 0, stdout: 'git version 2.43.0' };
      return { status: 0, stdout: 'version 6.1' };
    });
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(mockSpawnSync).toHaveBeenCalledWith('/custom/ffmpeg', ['-version'], expect.any(Object));
  });

  it('handles claude provider with ANTHROPIC_API_KEY set', async () => {
    mockGetConfig.mockReturnValue({
      FFMPEG_PATH: 'ffmpeg', FFPROBE_PATH: 'ffprobe',
      OPENAI_API_KEY: 'sk-test', EXA_API_KEY: '', WATCH_FOLDER: '',
      LLM_PROVIDER: 'claude', LLM_MODEL: undefined, ANTHROPIC_API_KEY: 'sk-ant-test', LATE_API_KEY: '',
    });
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('ANTHROPIC_API_KEY is set');
  });

  it('handles openai provider with key set', async () => {
    mockGetConfig.mockReturnValue({
      FFMPEG_PATH: 'ffmpeg', FFPROBE_PATH: 'ffprobe',
      OPENAI_API_KEY: 'sk-test', EXA_API_KEY: '', WATCH_FOLDER: '',
      LLM_PROVIDER: 'openai', LLM_MODEL: undefined, ANTHROPIC_API_KEY: undefined, LATE_API_KEY: '',
    });
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('OPENAI_API_KEY is set');
  });

  it('handles Late API listAccounts failure', async () => {
    mockGetConfig.mockReturnValue({
      FFMPEG_PATH: 'ffmpeg', FFPROBE_PATH: 'ffprobe',
      OPENAI_API_KEY: 'sk-test', EXA_API_KEY: '', WATCH_FOLDER: '',
      LLM_PROVIDER: undefined, LLM_MODEL: undefined, ANTHROPIC_API_KEY: undefined,
      LATE_API_KEY: 'valid-key',
    });
    mockValidateConnection.mockResolvedValue({ valid: true, profileName: 'TestProfile' });
    mockListAccounts.mockRejectedValue(new Error('fetch failed'));
    try { await runDoctor(); } catch { /* process.exit */ }
    expect(getLogs()).toContain('Could not fetch connected accounts');
  });
});