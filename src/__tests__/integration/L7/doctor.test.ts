import { describe, it, expect, vi, afterEach } from 'vitest'

// ── Mock setup (L1, L3 only) ─────────────────────────────────────────

const mockSpawnCommand = vi.hoisted(() => vi.fn())
const mockCreateModuleRequire = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/process/process.js', () => ({
  spawnCommand: mockSpawnCommand,
  createModuleRequire: mockCreateModuleRequire,
}))

const mockFileExistsSync = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExistsSync: mockFileExistsSync,
}))

const mockJoin = vi.hoisted(() => vi.fn((...parts: string[]) => parts.join('/')))
vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: mockJoin,
}))

const mockGetConfig = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: mockGetConfig,
}))

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const mockCreateLateApiClient = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/lateApi/lateApiService.js', () => ({
  createLateApiClient: mockCreateLateApiClient,
}))

const mockLoadScheduleConfig = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: mockLoadScheduleConfig,
}))

// ── Import after mocks ──────────────────────────────────────────────────

import { normalizeProviderName, runDoctor } from '../../../L7-app/commands/doctor.js'

// ── Helpers ─────────────────────────────────────────────────────────────

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    OPENAI_API_KEY: 'sk-test-key',
    EXA_API_KEY: 'exa-test-key',
    FFMPEG_PATH: 'ffmpeg',
    FFPROBE_PATH: 'ffprobe',
    WATCH_FOLDER: '',
    LLM_PROVIDER: '',
    LLM_MODEL: '',
    ANTHROPIC_API_KEY: '',
    LATE_API_KEY: '',
    ...overrides,
  }
}

/** Set up standard mocks for a "happy path" doctor run where everything passes. */
function setupPassingMocks() {
  mockGetConfig.mockReturnValue(makeConfig())
  mockFileExistsSync.mockReturnValue(true)
  mockCreateModuleRequire.mockReturnValue(() => {
    throw new Error('not installed')
  })
  mockSpawnCommand.mockImplementation((cmd: string) => {
    if (cmd === 'ffmpeg' || cmd === 'ffprobe') {
      return { status: 0, stdout: 'ffmpeg version 7.1.0' }
    }
    if (cmd === 'git') {
      return { status: 0, stdout: 'git version 2.45.0' }
    }
    return { status: 1, stdout: '' }
  })
  mockCreateLateApiClient.mockImplementation(() => ({
    validateConnection: async () => ({ valid: false }),
  }))
  mockLoadScheduleConfig.mockRejectedValue(new Error('not found'))
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('normalizeProviderName', () => {
  it('defaults to "copilot" when undefined', () => {
    expect(normalizeProviderName(undefined)).toBe('copilot')
  })

  it('defaults to "copilot" when empty string', () => {
    expect(normalizeProviderName('')).toBe('copilot')
  })

  it('lowercases provider name', () => {
    expect(normalizeProviderName('OpenAI')).toBe('openai')
  })

  it('trims whitespace', () => {
    expect(normalizeProviderName('  claude  ')).toBe('claude')
  })

  it('handles mixed case and whitespace', () => {
    expect(normalizeProviderName(' Copilot ')).toBe('copilot')
  })
})

describe('runDoctor', () => {
  const originalExit = process.exit
  let exitCode: number | undefined

  afterEach(() => {
    process.exit = originalExit
    exitCode = undefined
    vi.restoreAllMocks()
  })

  function interceptExit() {
    exitCode = undefined
    process.exit = ((code?: number) => {
      exitCode = code ?? 0
      throw new Error(`process.exit(${exitCode})`)
    }) as never
  }

  it('returns exit code 0 when all required checks pass', async () => {
    interceptExit()
    setupPassingMocks()

    await expect(runDoctor()).rejects.toThrow('process.exit(0)')
    expect(exitCode).toBe(0)
  })

  it('returns exit code 1 when FFmpeg is missing', async () => {
    interceptExit()
    setupPassingMocks()
    mockSpawnCommand.mockImplementation((cmd: string) => {
      if (cmd === 'ffmpeg') throw new Error('ENOENT')
      if (cmd === 'ffprobe') return { status: 0, stdout: 'ffprobe version 7.1.0' }
      if (cmd === 'git') return { status: 0, stdout: 'git version 2.45.0' }
      return { status: 1, stdout: '' }
    })

    await expect(runDoctor()).rejects.toThrow('process.exit(1)')
    expect(exitCode).toBe(1)
  })

  it('returns exit code 1 when FFprobe is missing', async () => {
    interceptExit()
    setupPassingMocks()
    mockSpawnCommand.mockImplementation((cmd: string) => {
      if (cmd === 'ffmpeg') return { status: 0, stdout: 'ffmpeg version 7.1.0' }
      if (cmd === 'ffprobe') throw new Error('ENOENT')
      if (cmd === 'git') return { status: 0, stdout: 'git version 2.45.0' }
      return { status: 1, stdout: '' }
    })

    await expect(runDoctor()).rejects.toThrow('process.exit(1)')
    expect(exitCode).toBe(1)
  })

  it('handles missing OPENAI_API_KEY gracefully (exit 1)', async () => {
    interceptExit()
    setupPassingMocks()
    mockGetConfig.mockReturnValue(makeConfig({ OPENAI_API_KEY: '' }))

    await expect(runDoctor()).rejects.toThrow('process.exit(1)')
    expect(exitCode).toBe(1)
  })

  it('passes when EXA_API_KEY is missing (optional)', async () => {
    interceptExit()
    setupPassingMocks()
    mockGetConfig.mockReturnValue(makeConfig({ EXA_API_KEY: '' }))

    await expect(runDoctor()).rejects.toThrow('process.exit(0)')
    expect(exitCode).toBe(0)
  })

  it('handles missing Git gracefully (optional check)', async () => {
    interceptExit()
    setupPassingMocks()
    mockSpawnCommand.mockImplementation((cmd: string) => {
      if (cmd === 'ffmpeg') return { status: 0, stdout: 'ffmpeg version 7.1.0' }
      if (cmd === 'ffprobe') return { status: 0, stdout: 'ffprobe version 7.1.0' }
      if (cmd === 'git') throw new Error('ENOENT')
      return { status: 1, stdout: '' }
    })

    await expect(runDoctor()).rejects.toThrow('process.exit(0)')
    expect(exitCode).toBe(0)
  })

  it('detects unknown LLM provider and fails', async () => {
    interceptExit()
    setupPassingMocks()
    mockGetConfig.mockReturnValue(makeConfig({ LLM_PROVIDER: 'invalid-provider' }))

    await expect(runDoctor()).rejects.toThrow('process.exit(1)')
    expect(exitCode).toBe(1)
  })

  it('checks ANTHROPIC_API_KEY when provider is claude', async () => {
    interceptExit()
    setupPassingMocks()
    mockGetConfig.mockReturnValue(makeConfig({
      LLM_PROVIDER: 'claude',
      ANTHROPIC_API_KEY: '',
    }))

    await expect(runDoctor()).rejects.toThrow('process.exit(1)')
    expect(exitCode).toBe(1)
  })

  it('passes with claude provider when ANTHROPIC_API_KEY is set', async () => {
    interceptExit()
    setupPassingMocks()
    mockGetConfig.mockReturnValue(makeConfig({
      LLM_PROVIDER: 'claude',
      ANTHROPIC_API_KEY: 'sk-ant-test-key',
    }))

    await expect(runDoctor()).rejects.toThrow('process.exit(0)')
    expect(exitCode).toBe(0)
  })

  it('validates Late API connection when key is set', async () => {
    interceptExit()
    setupPassingMocks()
    mockGetConfig.mockReturnValue(makeConfig({ LATE_API_KEY: 'late-test-key' }))
    mockCreateLateApiClient.mockImplementation(() => ({
      validateConnection: async () => ({ valid: true, profileName: 'Test Profile' }),
      listAccounts: async () => [{ platform: 'tiktok', username: 'testuser' }],
    }))

    await expect(runDoctor()).rejects.toThrow('process.exit(0)')
    expect(exitCode).toBe(0)
    expect(mockCreateLateApiClient).toHaveBeenCalledWith('late-test-key')
  })

  it('loads schedule config when schedule.json exists', async () => {
    interceptExit()
    setupPassingMocks()
    mockLoadScheduleConfig.mockResolvedValue({ platforms: { tiktok: {}, youtube: {} } })

    await expect(runDoctor()).rejects.toThrow('process.exit(0)')
    expect(exitCode).toBe(0)
    expect(mockLoadScheduleConfig).toHaveBeenCalled()
  })
})
