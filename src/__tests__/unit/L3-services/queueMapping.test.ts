import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { initConfig } from '../../../L1-infra/config/environment.js'

// ── L2 Mock ────────────────────────────────────────────────────────────

const mockListProfiles = vi.hoisted(() => vi.fn())
const mockListQueues = vi.hoisted(() => vi.fn())

vi.mock('../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.listProfiles = mockListProfiles
    this.listQueues = mockListQueues
  }),
}))

// ── Imports ────────────────────────────────────────────────────────────

import {
  getQueueId,
  getProfileId,
  getAllQueueMappings,
  refreshQueueMappings,
  clearQueueCache,
} from '../../../L3-services/queueMapping/queueMapping.js'

// ── Fixtures ───────────────────────────────────────────────────────────

const PROFILES = [{ _id: 'profile-123', name: 'Default' }]

const QUEUES_RESPONSE = {
  queues: [
    { _id: 'q1', name: 'youtube-shorts', profileId: 'profile-123', timezone: 'America/Chicago', slots: [], active: true, isDefault: false },
    { _id: 'q2', name: 'linkedin-medium-clips', profileId: 'profile-123', timezone: 'America/Chicago', slots: [], active: true, isDefault: false },
    { _id: 'q3', name: 'x-shorts', profileId: 'profile-123', timezone: 'America/Chicago', slots: [], active: true, isDefault: false },
  ],
  count: 3,
}

function setupDefaultMocks(): void {
  mockListProfiles.mockResolvedValue(PROFILES)
  mockListQueues.mockResolvedValue(QUEUES_RESPONSE)
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('queueMapping', () => {
  const cacheFile = path.join(process.cwd(), '.vidpipe-queue-cache.json')

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubEnv('LATE_PROFILE_ID', '')
    initConfig().LATE_PROFILE_ID = ''
    await clearQueueCache()
  })

  afterEach(async () => {
    await clearQueueCache()
    vi.unstubAllEnvs()
    initConfig()
    try { await fs.unlink(cacheFile) } catch { /* file may not exist */ }
  })

  test('LateProfileRouting.REQ-003: uses explicit profile, filters foreign queues and never falls back', async () => {
    vi.stubEnv('LATE_PROFILE_ID', 'profile-123')
    initConfig()
    mockListProfiles.mockResolvedValue([{ _id: 'other' }, ...PROFILES])
    mockListQueues.mockResolvedValue({
      queues: [...QUEUES_RESPONSE.queues, { _id: 'foreign', name: 'youtube-shorts', profileId: 'other' }],
    })
    expect(await getQueueId('youtube', 'shorts')).toBe('q1')
    expect(await getProfileId()).toBe('profile-123')
    expect(mockListQueues).toHaveBeenCalledWith('profile-123', true)
    vi.stubEnv('LATE_PROFILE_ID', 'missing')
    initConfig()
    expect(await getQueueId('youtube', 'shorts')).toBeNull()
    expect(await getProfileId()).toBe('')
  })

  test('LateProfileRouting.REQ-004: invalidates memory and file cache after profile switch', async () => {
    setupDefaultMocks()
    await getQueueId('youtube', 'shorts')
    vi.stubEnv('LATE_PROFILE_ID', 'other')
    initConfig()
    mockListProfiles.mockResolvedValue([{ _id: 'other' }, ...PROFILES])
    mockListQueues.mockResolvedValue({ queues: [{ _id: 'other-queue', name: 'youtube-shorts', profileId: 'other' }] })
    expect(await getQueueId('youtube', 'shorts')).toBe('other-queue')
    expect(await getProfileId()).toBe('other')
    expect(mockListQueues).toHaveBeenCalledTimes(2)
  })

  test('LateProfileRouting.REQ-004: ignores legacy file cache without configuration scope', async () => {
    setupDefaultMocks()
    await fs.writeFile(cacheFile, JSON.stringify({
      profileId: 'other', mappings: { 'youtube-shorts': 'unsafe' }, fetchedAt: new Date().toISOString(),
    }))
    expect(await getQueueId('youtube', 'shorts')).toBe('q1')
    expect(mockListQueues).toHaveBeenCalledTimes(1)
  })

  test.each([
    { configuredProfileId: 'other', profileId: 'other' },
    { configuredProfileId: 'profile-123', profileId: 'other' },
  ])('LateProfileRouting.REQ-004: rejects foreign or contradictory file cache owner (%j)', async (scope) => {
    vi.stubEnv('LATE_PROFILE_ID', 'profile-123')
    initConfig()
    setupDefaultMocks()
    await fs.writeFile(cacheFile, JSON.stringify({
      ...scope, mappings: { 'youtube-shorts': 'unsafe' }, fetchedAt: new Date().toISOString(),
    }))
    expect(await getQueueId('youtube', 'shorts')).toBe('q1')
    expect(await getProfileId()).toBe('profile-123')
  })

  test('LateProfileRouting.REQ-005: chooses unique default and rejects ambiguous profiles', async () => {
    mockListProfiles.mockResolvedValue([{ _id: 'other' }, { ...PROFILES[0], isDefault: true }])
    mockListQueues.mockResolvedValue(QUEUES_RESPONSE)
    expect(await getProfileId()).toBe('profile-123')
    await clearQueueCache()
    mockListProfiles.mockResolvedValue([{ _id: 'other' }, ...PROFILES])
    expect(await getProfileId()).toBe('')
  })

  describe('getQueueId', () => {
    test('returns correct queueId for valid platform+clipType', async () => {
      setupDefaultMocks()

      const id = await getQueueId('youtube', 'shorts')
      expect(id).toBe('q1')
    })

    test('normalizes twitter to x for queue name lookup', async () => {
      setupDefaultMocks()

      const id = await getQueueId('twitter', 'shorts')
      // Should match the 'x-shorts' queue (q3), not look for 'twitter-shorts'
      expect(id).toBe('q3')
    })

    test('returns null when no queue matches', async () => {
      setupDefaultMocks()

      const id = await getQueueId('tiktok', 'shorts')
      expect(id).toBeNull()
    })

    test('normalizes medium-clip to medium for queue name lookup', async () => {
      setupDefaultMocks()
      // Override with a queue that uses the normalized 'medium' name
      mockListQueues.mockResolvedValue({
        queues: [
          { _id: 'q-med', name: 'linkedin-medium', profileId: 'profile-123', timezone: 'America/Chicago', slots: [], active: true, isDefault: false },
        ],
        count: 1,
      })
      await clearQueueCache()

      const id = await getQueueId('linkedin', 'medium-clip')
      expect(id).toBe('q-med')
    })
  })

  describe('getProfileId', () => {
    test('returns the cached profile ID from Late API', async () => {
      setupDefaultMocks()

      const profileId = await getProfileId()
      expect(profileId).toBe('profile-123')
    })
  })

  describe('caching', () => {
    test('second call uses cache and does not re-fetch from API', async () => {
      setupDefaultMocks()

      const id1 = await getQueueId('youtube', 'shorts')
      const id2 = await getQueueId('youtube', 'shorts')

      expect(id1).toBe('q1')
      expect(id2).toBe('q1')
      expect(mockListProfiles).toHaveBeenCalledTimes(1)
      expect(mockListQueues).toHaveBeenCalledTimes(1)
    })
  })

  describe('refreshQueueMappings', () => {
    test('clears cache and re-fetches from API', async () => {
      setupDefaultMocks()

      await getQueueId('youtube', 'shorts')
      expect(mockListProfiles).toHaveBeenCalledTimes(1)

      const mappings = await refreshQueueMappings()

      expect(mockListProfiles).toHaveBeenCalledTimes(2)
      expect(mockListQueues).toHaveBeenCalledTimes(2)
      expect(mappings).toHaveProperty('youtube-shorts', 'q1')
      expect(mappings).toHaveProperty('x-shorts', 'q3')
    })
  })

  describe('clearQueueCache', () => {
    test('clears memory cache so next call re-fetches', async () => {
      setupDefaultMocks()

      await getQueueId('youtube', 'shorts')
      expect(mockListProfiles).toHaveBeenCalledTimes(1)

      await clearQueueCache()

      await getQueueId('youtube', 'shorts')
      expect(mockListProfiles).toHaveBeenCalledTimes(2)
    })
  })

  describe('getAllQueueMappings', () => {
    test('returns all mappings as a Record', async () => {
      setupDefaultMocks()

      const mappings = await getAllQueueMappings()

      expect(mappings).toEqual({
        'youtube-shorts': 'q1',
        'linkedin-medium-clips': 'q2',
        'x-shorts': 'q3',
      })
    })

    test('returns a copy — mutating result does not affect cache', async () => {
      setupDefaultMocks()

      const first = await getAllQueueMappings()
      first['youtube-shorts'] = 'MUTATED'
      first['new-key'] = 'injected'

      const second = await getAllQueueMappings()

      expect(second['youtube-shorts']).toBe('q1')
      expect(second).not.toHaveProperty('new-key')
    })
  })

  describe('API failure', () => {
    test('getQueueId returns null when listProfiles throws', async () => {
      mockListProfiles.mockRejectedValue(new Error('Network error'))

      const id = await getQueueId('youtube', 'shorts')
      expect(id).toBeNull()
    })

    test('getProfileId returns empty string when listProfiles throws', async () => {
      mockListProfiles.mockRejectedValue(new Error('Network error'))

      const profileId = await getProfileId()
      expect(profileId).toBe('')
    })

    test('getQueueId returns null when listQueues throws', async () => {
      mockListProfiles.mockResolvedValue(PROFILES)
      mockListQueues.mockRejectedValue(new Error('Server error'))

      const id = await getQueueId('youtube', 'shorts')
      expect(id).toBeNull()
    })
  })

  describe('empty queues', () => {
    test('returns null and logs warning when no queues exist', async () => {
      mockListProfiles.mockResolvedValue(PROFILES)
      mockListQueues.mockResolvedValue({ queues: [], count: 0 })

      const id = await getQueueId('youtube', 'shorts')
      expect(id).toBeNull()
    })
  })
})
