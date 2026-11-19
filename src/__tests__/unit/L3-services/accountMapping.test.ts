import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { initConfig } from '../../../L1-infra/config/environment.js'
import { Platform } from '../../../L0-pure/types/index.js'
import { getAccountId, clearAccountCache } from '../../../L3-services/socialPosting/accountMapping.js'

const { listAccounts, listProfiles } = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listProfiles: vi.fn(),
}))
vi.mock('../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: vi.fn().mockImplementation(function () {
    return { listAccounts, listProfiles }
  }),
}))

const accounts = [
  { _id: 'target-x', platform: 'twitter', isActive: true, profileId: { _id: 'target', name: 'Target' } },
  { _id: 'target-instagram', platform: 'instagram', isActive: true, profileId: 'target' },
  { _id: 'inactive', platform: 'youtube', isActive: false, profileId: 'target' },
  { _id: 'other-x', platform: 'twitter', isActive: true, profileId: 'other' },
  { _id: 'other-linkedin', platform: 'linkedin', isActive: true, profileId: 'other' },
]
const cacheFile = path.join(process.cwd(), '.vidpipe-cache.json')

function configure(profileId: string): void {
  vi.stubEnv('LATE_PROFILE_ID', profileId)
  initConfig().LATE_PROFILE_ID = profileId
}

describe('accountMapping', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    configure('target')
    listAccounts.mockResolvedValue(accounts)
    listProfiles.mockResolvedValue([{ _id: 'target', name: 'Target' }])
    await clearAccountCache()
  })
  afterEach(async () => {
    await clearAccountCache()
    vi.unstubAllEnvs()
    initConfig()
  })

  it('LateProfileRouting.REQ-001: excludes cross-profile collisions, missing platforms and inactive accounts', async () => {
    expect(await getAccountId(Platform.X)).toBe('target-x')
    expect(await getAccountId(Platform.Instagram)).toBe('target-instagram')
    expect(await getAccountId(Platform.LinkedIn)).toBeNull()
    expect(await getAccountId(Platform.YouTube)).toBeNull()
    expect(listAccounts).toHaveBeenCalledTimes(1)
  })

  it('LateProfileRouting.REQ-002: invalidates memory and file caches when configured profile changes', async () => {
    expect(await getAccountId(Platform.X)).toBe('target-x')
    configure('other')
    expect(await getAccountId(Platform.X)).toBe('other-x')
    expect(listAccounts).toHaveBeenCalledTimes(2)
    expect(JSON.parse(await fs.readFile(cacheFile, 'utf8'))).toMatchObject({
      profileId: 'other', configuredProfileId: 'other',
    })
  })

  it.each([undefined, 'other'])('LateProfileRouting.REQ-002: discards legacy or differently scoped file cache (%s)', async (scope) => {
    await fs.writeFile(cacheFile, JSON.stringify({
      accounts: { twitter: 'unsafe' }, fetchedAt: new Date().toISOString(),
      ...(scope ? { configuredProfileId: scope, profileId: scope } : {}),
    }))
    expect(await getAccountId(Platform.X)).toBe('target-x')
    expect(listAccounts).toHaveBeenCalledTimes(1)
  })

  it('LateProfileRouting.REQ-002: rejects a file cache whose owner contradicts its explicit scope', async () => {
    await fs.writeFile(cacheFile, JSON.stringify({
      accounts: { twitter: 'unsafe' }, fetchedAt: new Date().toISOString(),
      configuredProfileId: 'target', profileId: 'other',
    }))
    expect(await getAccountId(Platform.X)).toBe('target-x')
  })

  it('LateProfileRouting.REQ-001: invalid explicit profile never falls back', async () => {
    configure('missing')
    expect(await getAccountId(Platform.X)).toBeNull()
  })

  it('LateProfileRouting.REQ-005: selects the unique default rather than account order', async () => {
    configure('')
    listProfiles.mockResolvedValue([
      { _id: 'other', name: 'Other' },
      { _id: 'target', name: 'Target', isDefault: true },
    ])
    expect(await getAccountId(Platform.X)).toBe('target-x')
  })

  it('LateProfileRouting.REQ-005: fails closed for ambiguous profiles', async () => {
    configure('')
    listProfiles.mockResolvedValue([{ _id: 'target' }, { _id: 'other' }])
    expect(await getAccountId(Platform.X)).toBeNull()
  })

  it('LateProfileRouting.REQ-005: preserves single-profile selection', async () => {
    configure('')
    expect(await getAccountId(Platform.X)).toBe('target-x')
  })

  it('LateProfileRouting.REQ-005: no accessible profiles means no accounts', async () => {
    configure('')
    listProfiles.mockResolvedValue([])
    expect(await getAccountId(Platform.X)).toBeNull()
    expect(listAccounts).not.toHaveBeenCalled()
  })

  it('returns null when the API fails and clear forces refresh', async () => {
    listAccounts.mockRejectedValueOnce(new Error('Network error'))
    expect(await getAccountId(Platform.X)).toBeNull()
    expect(await getAccountId(Platform.X)).toBe('target-x')
    await clearAccountCache()
    expect(await getAccountId(Platform.X)).toBe('target-x')
    expect(listAccounts).toHaveBeenCalledTimes(3)
  })
})
