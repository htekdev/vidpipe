import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetConfigPath,
  mockLoadGlobalConfig,
  mockSaveGlobalConfig,
  mockSetGlobalConfigValue,
  mockGetGlobalConfigValue,
  mockResetGlobalConfig,
  mockMaskSecret,
  mockCreateInterface,
  mockQuestion,
  mockClose,
  mockConsoleLog,
} = vi.hoisted(() => ({
  mockGetConfigPath: vi.fn(),
  mockLoadGlobalConfig: vi.fn(),
  mockSaveGlobalConfig: vi.fn(),
  mockSetGlobalConfigValue: vi.fn(),
  mockGetGlobalConfigValue: vi.fn(),
  mockResetGlobalConfig: vi.fn(),
  mockMaskSecret: vi.fn(),
  mockCreateInterface: vi.fn(),
  mockQuestion: vi.fn(),
  mockClose: vi.fn(),
  mockConsoleLog: vi.fn(),
}))

vi.mock('../../../L1-infra/config/globalConfig.js', () => ({
  getConfigPath: mockGetConfigPath,
  loadGlobalConfig: mockLoadGlobalConfig,
  saveGlobalConfig: mockSaveGlobalConfig,
  setGlobalConfigValue: mockSetGlobalConfigValue,
  getGlobalConfigValue: mockGetGlobalConfigValue,
  resetGlobalConfig: mockResetGlobalConfig,
  maskSecret: mockMaskSecret,
}))

vi.mock('../../../L1-infra/readline/readlinePromises.js', () => ({
  createPromptInterface: mockCreateInterface,
}))

import { runConfigure } from '../../../L7-app/commands/configure.js'

describe('L7 Integration: configure command', () => {
  const originalExitCode = process.exitCode

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(mockConsoleLog)

    process.exitCode = undefined

    mockGetConfigPath.mockReturnValue('C:\\Users\\test\\AppData\\Roaming\\vidpipe\\config.json')
    mockLoadGlobalConfig.mockReturnValue({
      credentials: {},
      defaults: {},
    })
    mockGetGlobalConfigValue.mockReturnValue(undefined)
    mockMaskSecret.mockImplementation((value: string) => `masked:${value}`)
    mockCreateInterface.mockReturnValue({
      question: mockQuestion,
      close: mockClose,
    })
    mockQuestion.mockResolvedValue('n')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = originalExitCode
  })

  function getLogs(): string {
    return mockConsoleLog.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
  }

  it.each([
    ['storage-provider', 'storageProvider', 'aws'],
    ['aws-region', 'awsRegion', 'us-west-2'],
    ['aws-s3-bucket', 'awsS3Bucket', 'media'],
    ['aws-s3-prefix', 'awsS3Prefix', 'vidpipe'],
    ['aws-dynamodb-content-table', 'awsDynamodbContentTable', 'content'],
    ['aws-dynamodb-videos-table', 'awsDynamodbVideosTable', 'videos'],
  ])('configure.REQ-001: supports %s set/get and defaults dot notation', async (alias, key, value) => {
    mockGetGlobalConfigValue.mockReturnValue(value)
    await runConfigure('set', [alias, value])
    expect(mockSetGlobalConfigValue).toHaveBeenCalledWith('defaults', key, value)
    await runConfigure('get', [alias])
    expect(mockGetGlobalConfigValue).toHaveBeenCalledWith('defaults', key)
    expect(getLogs()).toContain(`defaults.${key} = ${value}`)
    await runConfigure('set', [`defaults.${key}`, value])
    expect(mockSetGlobalConfigValue).toHaveBeenLastCalledWith('defaults', key, value)
    expect(mockMaskSecret).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
  })

  it('configure.REQ-001: lists AWS resource values as non-secret defaults', async () => {
    mockLoadGlobalConfig.mockReturnValue({
      credentials: {},
      defaults: { storageProvider: 'aws', awsRegion: 'us-west-2', awsS3Bucket: 'media' },
    })
    await runConfigure('list')
    expect(getLogs()).toContain('defaults.storageProvider')
    expect(getLogs()).toContain('defaults.awsS3Bucket')
    expect(getLogs()).toContain('media')
    expect(getLogs()).toContain('defaults.awsDynamodbVideosTable')
    expect(mockMaskSecret).not.toHaveBeenCalled()
  })

  it.each(['storage-provider', 'defaults.storageProvider'])('configure.REQ-002: rejects invalid provider via %s before saving', async (key) => {
    await runConfigure('set', [key, 'gcp'])
    expect(mockSetGlobalConfigValue).not.toHaveBeenCalled()
    expect(getLogs()).toMatch(/azure.*aws/)
    expect(process.exitCode).toBe(1)
  })

  it.each(['aws-access-key-id', 'aws-secret-access-key', 'credentials.awsAccessKeyId', 'credentials.awsSecretAccessKey'])(
    'configure.REQ-002: does not offer static AWS secret storage through %s',
    async (key) => {
      await runConfigure('set', [key, 'not-a-credential'])
      expect(mockSetGlobalConfigValue).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
    },
  )

  it('maps openai-key to credentials.openaiApiKey for set', async () => {
    mockGetGlobalConfigValue.mockReturnValue('sk-xxx')

    await runConfigure('set', ['openai-key', 'sk-xxx'])

    expect(mockSetGlobalConfigValue).toHaveBeenCalledWith('credentials', 'openaiApiKey', 'sk-xxx')
    expect(mockGetGlobalConfigValue).toHaveBeenCalledWith('credentials', 'openaiApiKey')
    expect(mockMaskSecret).toHaveBeenCalledWith('sk-xxx')
    expect(getLogs()).toContain('Set credentials.openaiApiKey = masked:sk-xxx')
  })

  it('masks credential values for get', async () => {
    mockGetGlobalConfigValue.mockReturnValue('sk-secret-value')

    await runConfigure('get', ['openai-key'])

    expect(mockGetGlobalConfigValue).toHaveBeenCalledWith('credentials', 'openaiApiKey')
    expect(mockMaskSecret).toHaveBeenCalledWith('sk-secret-value')
    expect(getLogs()).toContain('credentials.openaiApiKey = masked:sk-secret-value')
  })

  it('shows non-credential values directly for get', async () => {
    mockGetGlobalConfigValue.mockReturnValue('claude')

    await runConfigure('get', ['llm-provider'])

    expect(mockGetGlobalConfigValue).toHaveBeenCalledWith('defaults', 'llmProvider')
    expect(mockMaskSecret).not.toHaveBeenCalled()
    expect(getLogs()).toContain('defaults.llmProvider = claude')
  })

  it('loads and prints config rows with credentials masked for list', async () => {
    mockLoadGlobalConfig.mockReturnValue({
      credentials: {
        openaiApiKey: 'sk-secret-value',
      },
      defaults: {
        llmProvider: 'claude',
      },
    })

    await runConfigure('list')

    expect(mockLoadGlobalConfig).toHaveBeenCalledTimes(1)
    expect(mockMaskSecret).toHaveBeenCalledWith('sk-secret-value')
    const logs = getLogs()
    expect(logs).toContain('credentials.openaiApiKey')
    expect(logs).toContain('masked:sk-secret-value')
    expect(logs).toContain('defaults.llmProvider')
    expect(logs).toContain('claude')
    expect(logs).toContain('defaults.storageProvider')
  })

  it('resets config when reset is confirmed', async () => {
    mockQuestion.mockResolvedValue('yes')

    await runConfigure('reset')

    expect(mockCreateInterface).toHaveBeenCalledOnce()
    expect(mockGetConfigPath).toHaveBeenCalledTimes(1)
    expect(mockQuestion).toHaveBeenCalledWith('Delete the global config file? [y/N]: ')
    expect(mockResetGlobalConfig).toHaveBeenCalledTimes(1)
    expect(mockClose).toHaveBeenCalledTimes(1)
    expect(getLogs()).toContain('Global configuration reset.')
  })

  it('does not reset config when reset is not confirmed', async () => {
    mockQuestion.mockResolvedValue('no')

    await runConfigure('reset')

    expect(mockResetGlobalConfig).not.toHaveBeenCalled()
    expect(mockClose).toHaveBeenCalledTimes(1)
    expect(getLogs()).toContain('Reset cancelled.')
  })

  it('prints the config path for path', async () => {
    await runConfigure('path')

    expect(mockGetConfigPath).toHaveBeenCalledTimes(1)
    expect(mockConsoleLog).toHaveBeenCalledWith('C:\\Users\\test\\AppData\\Roaming\\vidpipe\\config.json')
  })

  it('runs the interactive wizard when no subcommand is provided', async () => {
    mockQuestion
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('sk-openai')
      .mockResolvedValueOnce('invalid-provider')
      .mockResolvedValueOnce('claude')
      .mockResolvedValueOnce('anthropic-secret')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')

    await runConfigure()

    expect(mockSaveGlobalConfig).toHaveBeenCalledTimes(3)
    expect(mockClose).toHaveBeenCalledTimes(1)

    const logs = getLogs()
    expect(logs).toContain('VidPipe global configuration')
    expect(logs).toContain('This value is required.')
    expect(logs).toContain('Please choose one of: copilot, openai, claude.')
    expect(logs).toContain('Saved credentials.openaiApiKey')
    expect(logs).toContain('Saved defaults.llmProvider = claude')
    expect(logs).toContain('Saved credentials.anthropicApiKey')
    expect(logs).toContain('Global configuration updated.')
  })

  it('prints a usage error when set is missing a value', async () => {
    await runConfigure('set', ['openai-key'])

    expect(getLogs()).toContain('Usage: vidpipe configure set <key> <value>')
    expect(process.exitCode).toBe(1)
  })

  it('prints an error when set receives an unknown key', async () => {
    await runConfigure('set', ['unknown-key', 'value'])

    expect(getLogs()).toContain('Unknown config key: unknown-key')
    expect(process.exitCode).toBe(1)
  })

  it('prints a usage error when get is missing a key', async () => {
    await runConfigure('get')

    expect(getLogs()).toContain('Usage: vidpipe configure get <key>')
    expect(process.exitCode).toBe(1)
  })

  it('prints an error when get receives an unknown key', async () => {
    await runConfigure('get', ['unknown-key'])

    expect(getLogs()).toContain('Unknown config key: unknown-key')
    expect(process.exitCode).toBe(1)
  })

  it('prints an error for an unknown subcommand', async () => {
    await runConfigure('nope')

    expect(getLogs()).toContain('Unknown configure subcommand: nope')
    expect(process.exitCode).toBe(1)
  })

  it('maps schedule-config to defaults.scheduleConfig for set', async () => {
    mockGetGlobalConfigValue.mockReturnValue('/shared/schedule.json')

    await runConfigure('set', ['schedule-config', '/shared/schedule.json'])

    expect(mockSetGlobalConfigValue).toHaveBeenCalledWith('defaults', 'scheduleConfig', '/shared/schedule.json')
  })
})
