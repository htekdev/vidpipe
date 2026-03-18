import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetGlobalConfigValue = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/config/globalConfig.js', () => ({
  getGlobalConfigValue: mockGetGlobalConfigValue,
}))

const mockJoin = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: mockJoin,
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readTextFile: vi.fn(),
  writeFileRaw: vi.fn(),
}))

import { resolveSchedulePath } from '../../../L2-clients/scheduleStore/scheduleStore.js'

describe('resolveSchedulePath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetGlobalConfigValue.mockReturnValue(undefined)
    mockJoin.mockImplementation((...parts: unknown[]) => parts.map(String).join('/'))
  })

  it('returns the explicit configPath when provided', () => {
    const result = resolveSchedulePath('/explicit/schedule.json')

    expect(result).toBe('/explicit/schedule.json')
    expect(mockGetGlobalConfigValue).not.toHaveBeenCalled()
  })

  it('returns global config scheduleConfig when no explicit path', () => {
    mockGetGlobalConfigValue.mockReturnValue('/global/shared-schedule.json')

    const result = resolveSchedulePath()

    expect(result).toBe('/global/shared-schedule.json')
    expect(mockGetGlobalConfigValue).toHaveBeenCalledWith('defaults', 'scheduleConfig')
  })

  it('falls back to cwd/schedule.json when no explicit path and no global config', () => {
    mockGetGlobalConfigValue.mockReturnValue(undefined)

    const result = resolveSchedulePath()

    expect(result).toContain('schedule.json')
    expect(mockJoin).toHaveBeenCalledWith(process.cwd(), 'schedule.json')
  })
})
