/**
 * L3 Integration Test — queueMapping + queueSync services
 *
 * Mock boundary: L1 infrastructure (fileSystem, paths, config, logger)
 * Real code:     L2 LateApiClient (runs real, fetch is stubbed globally),
 *                L3 queueMapping cache logic, L3 queueSync orchestration,
 *                L3 scheduleConfig validation + defaults
 *
 * The L2 LateApiClient is NOT mocked — it runs real code. Its external HTTP
 * calls are intercepted via vi.stubGlobal('fetch', mockFetch), which is a
 * builtin stub (not a layer-path mock). This follows the same pattern as
 * lateApiService.test.ts.
 *
 * Validates:
 * 1. queueMapping + queueSync integration — sync creates queues, mapping resolves them
 * 2. queueSync with schedule config — converts schedule config to queue definitions
 * 3. queueMapping cache lifecycle — fetch → cache → refresh cycle
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

// ── Mock L1 infrastructure ────────────────────────────────────────────

const mockReadTextFile = vi.hoisted(() => vi.fn())
const mockWriteTextFile = vi.hoisted(() => vi.fn())
const mockRemoveFile = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readTextFile: mockReadTextFile,
  writeTextFile: mockWriteTextFile,
  removeFile: mockRemoveFile,
  writeFileRaw: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
  resolve: vi.fn((...args: string[]) => args.join('/')),
  sep: '/',
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ LATE_API_KEY: 'test-queue-integration-key' }),
  initConfig: vi.fn(),
}))

// ── Stub fetch globally (builtin, not a layer path) ───────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Logger is auto-mocked by global setup.ts

// ── Import after mocks ───────────────────────────────────────────────

import {
  getQueueId,
  getProfileId,
  getAllQueueMappings,
  refreshQueueMappings,
  clearQueueCache,
} from '../../../L3-services/queueMapping/queueMapping.js'

import { syncQueuesToLate } from '../../../L3-services/queueSync/queueSync.js'

import {
  clearScheduleCache,
} from '../../../L3-services/scheduler/scheduleConfig.js'

import type { ScheduleConfig } from '../../../L3-services/scheduler/scheduleConfig.js'

// ── Helpers ───────────────────────────────────────────────────────────

function fakeResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Map([['Content-Type', 'application/json']]),
  }
}

function fakeErrorResponse(status: number, body = 'Server Error') {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error('Not JSON')),
    text: () => Promise.resolve(body),
    headers: new Map(),
    statusText: 'Error',
  }
}

function makeQueueCache(
  mappings: Record<string, string>,
  profileId = 'profile-1',
  fetchedAt?: string,
) {
  return {
    mappings,
    profileId,
    fetchedAt: fetchedAt ?? new Date().toISOString(),
  }
}

/** Build the JSON shape that the Late API /queue/slots endpoint returns. */
function queuesApiBody(queues: Array<{ _id: string; name: string; slots?: Array<{ dayOfWeek: number; time: string }>; active?: boolean }>) {
  return {
    queues: queues.map((q) => ({
      _id: q._id,
      profileId: 'profile-1',
      name: q.name,
      timezone: 'America/Chicago',
      slots: q.slots ?? [],
      active: q.active ?? true,
      isDefault: false,
    })),
    count: queues.length,
  }
}

/** Build the JSON shape that the Late API /profiles endpoint returns. */
function profilesApiBody(profiles: Array<{ _id: string; name: string }>) {
  return { profiles }
}

/** Build the JSON shape that the Late API POST/PUT /queue/slots returns. */
function queueMutationBody(queueId: string, name: string) {
  return {
    success: true,
    schedule: {
      _id: queueId,
      profileId: 'profile-1',
      name,
      timezone: 'America/Chicago',
      slots: [],
      active: true,
      isDefault: false,
    },
  }
}

/** Set up fetch to return listProfiles + listQueues responses (for cache refresh). */
function stubFetchForRefresh(
  profiles: Array<{ _id: string; name: string }>,
  queues: Array<{ _id: string; name: string; slots?: Array<{ dayOfWeek: number; time: string }> }>,
) {
  mockFetch
    .mockResolvedValueOnce(fakeResponse(profilesApiBody(profiles)))
    .mockResolvedValueOnce(fakeResponse(queuesApiBody(queues)))
}

const SCHEDULE_WITH_CLIP_TYPES: ScheduleConfig = {
  timezone: 'America/Chicago',
  platforms: {
    youtube: {
      slots: [],
      avoidDays: [],
      byClipType: {
        shorts: {
          slots: [{ days: ['mon', 'wed', 'fri'], time: '18:00', label: 'YT Shorts' }],
          avoidDays: [],
        },
        'medium-clips': {
          slots: [{ days: ['tue', 'thu'], time: '20:00', label: 'YT Medium' }],
          avoidDays: [],
        },
      },
    },
    tiktok: {
      slots: [],
      avoidDays: [],
      byClipType: {
        shorts: {
          slots: [{ days: ['mon', 'wed'], time: '19:00', label: 'TT Shorts' }],
          avoidDays: [],
        },
      },
    },
    twitter: {
      slots: [],
      avoidDays: [],
      byClipType: {
        shorts: {
          slots: [{ days: ['fri'], time: '12:00', label: 'X Shorts' }],
          avoidDays: [],
        },
      },
    },
  },
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('L3 Integration: queueMapping cache lifecycle', () => {
  beforeEach(async () => {
    await clearQueueCache()
    vi.clearAllMocks()
  })

  // ── clearQueueCache ───────────────────────────────────────────────

  test('clearQueueCache calls removeFile on cache path', async () => {
    mockRemoveFile.mockResolvedValueOnce(undefined)

    await clearQueueCache()

    expect(mockRemoveFile).toHaveBeenCalledWith(
      expect.stringContaining('.vidpipe-queue-cache.json'),
    )
  })

  test('clearQueueCache tolerates missing file', async () => {
    mockRemoveFile.mockRejectedValueOnce(new Error('ENOENT'))

    await expect(clearQueueCache()).resolves.toBeUndefined()
  })

  // ── File cache reads ──────────────────────────────────────────────

  test('getAllQueueMappings loads from file cache when valid', async () => {
    const cache = makeQueueCache({
      'youtube-shorts': 'q-yt-s',
      'tiktok-shorts': 'q-tt-s',
    })
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(cache))

    const mappings = await getAllQueueMappings()

    expect(mappings).toEqual({
      'youtube-shorts': 'q-yt-s',
      'tiktok-shorts': 'q-tt-s',
    })
    expect(mockReadTextFile).toHaveBeenCalledWith(
      expect.stringContaining('.vidpipe-queue-cache.json'),
    )
  })

  test('getQueueId returns correct ID from file cache', async () => {
    const cache = makeQueueCache({
      'youtube-shorts': 'q-yt-s',
      'x-shorts': 'q-x-s',
      'linkedin-medium-clips': 'q-li-mc',
    })
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(cache))

    const id = await getQueueId('youtube', 'shorts')
    expect(id).toBe('q-yt-s')
  })

  test('getQueueId normalizes twitter to x', async () => {
    const cache = makeQueueCache({ 'x-shorts': 'q-x-s' })
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(cache))

    const id = await getQueueId('twitter', 'shorts')
    expect(id).toBe('q-x-s')
  })

  test('getQueueId returns null for unmatched queue', async () => {
    const cache = makeQueueCache({ 'youtube-shorts': 'q-yt-s' })
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(cache))

    const id = await getQueueId('mastodon', 'shorts')
    expect(id).toBeNull()
  })

  test('getProfileId returns cached profile ID', async () => {
    const cache = makeQueueCache({ 'youtube-shorts': 'q-1' }, 'my-profile-42')
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(cache))

    const profileId = await getProfileId()
    expect(profileId).toBe('my-profile-42')
  })

  // ── Stale / invalid cache → real L2 client fetch ──────────────────

  test('stale file cache triggers API re-fetch through real L2 client', async () => {
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    const staleCache = makeQueueCache({ 'youtube-shorts': 'stale-id' }, 'profile-1', staleDate)
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(staleCache))

    // Real L2 LateApiClient makes fetch calls — stub returns controlled data
    stubFetchForRefresh(
      [{ _id: 'profile-fresh', name: 'Fresh' }],
      [{ _id: 'q-fresh', name: 'youtube-shorts' }],
    )
    mockWriteTextFile.mockResolvedValueOnce(undefined)

    const mappings = await getAllQueueMappings()
    expect(mappings['youtube-shorts']).toBe('q-fresh')
    expect(mockFetch).toHaveBeenCalledTimes(2) // listProfiles + listQueues
  })

  test('invalid JSON in file cache falls through to real L2 client', async () => {
    mockReadTextFile.mockResolvedValueOnce('not json')

    stubFetchForRefresh(
      [{ _id: 'p-1', name: 'Test' }],
      [{ _id: 'q-1', name: 'tiktok-shorts' }],
    )
    mockWriteTextFile.mockResolvedValueOnce(undefined)

    const mappings = await getAllQueueMappings()
    expect(mappings['tiktok-shorts']).toBe('q-1')
  })

  test('missing file cache falls through to real L2 client', async () => {
    mockReadTextFile.mockRejectedValueOnce(new Error('ENOENT'))

    stubFetchForRefresh(
      [{ _id: 'p-1', name: 'Test' }],
      [{ _id: 'q-1', name: 'instagram-shorts' }],
    )
    mockWriteTextFile.mockResolvedValueOnce(undefined)

    const mappings = await getAllQueueMappings()
    expect(mappings['instagram-shorts']).toBe('q-1')
  })

  // ── Memory cache ──────────────────────────────────────────────────

  test('second call uses memory cache without re-reading file', async () => {
    const cache = makeQueueCache({ 'youtube-shorts': 'q-mem' })
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(cache))

    const first = await getAllQueueMappings()
    const second = await getAllQueueMappings()

    expect(first).toEqual(second)
    expect(mockReadTextFile).toHaveBeenCalledTimes(1)
    expect(mockFetch).not.toHaveBeenCalled() // No API calls needed
  })

  test('clearQueueCache forces re-read on next call', async () => {
    const cacheA = makeQueueCache({ 'youtube-shorts': 'q-a' })
    const cacheB = makeQueueCache({ 'youtube-shorts': 'q-b' })

    mockReadTextFile
      .mockResolvedValueOnce(JSON.stringify(cacheA))
      .mockResolvedValueOnce(JSON.stringify(cacheB))
    mockRemoveFile.mockResolvedValue(undefined)

    const first = await getAllQueueMappings()
    expect(first['youtube-shorts']).toBe('q-a')

    await clearQueueCache()

    const second = await getAllQueueMappings()
    expect(second['youtube-shorts']).toBe('q-b')
    expect(mockReadTextFile).toHaveBeenCalledTimes(2)
  })

  // ── refreshQueueMappings ──────────────────────────────────────────

  test('refreshQueueMappings bypasses cache and fetches via real L2 client', async () => {
    // Prime memory cache from file
    const cache = makeQueueCache({ 'old-queue': 'old-id' })
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(cache))
    await getAllQueueMappings()

    // Refresh should hit API (real L2 client → stubbed fetch)
    stubFetchForRefresh(
      [{ _id: 'p-1', name: 'Refresh' }],
      [
        { _id: 'q-new-1', name: 'youtube-shorts' },
        { _id: 'q-new-2', name: 'tiktok-shorts' },
      ],
    )
    mockWriteTextFile.mockResolvedValueOnce(undefined)

    const refreshed = await refreshQueueMappings()
    expect(refreshed).toEqual({
      'youtube-shorts': 'q-new-1',
      'tiktok-shorts': 'q-new-2',
    })
    // Two fetch calls: GET /profiles, GET /queue/slots
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  // ── No profiles ───────────────────────────────────────────────────

  test('returns empty mappings when no profiles found', async () => {
    mockReadTextFile.mockRejectedValueOnce(new Error('ENOENT'))

    // Real L2 client gets empty profiles
    mockFetch.mockResolvedValueOnce(fakeResponse(profilesApiBody([])))

    const mappings = await getAllQueueMappings()
    expect(mappings).toEqual({})
  })
})

describe('L3 Integration: queueSync with schedule config', () => {
  beforeEach(async () => {
    await clearQueueCache()
    clearScheduleCache()
    vi.clearAllMocks()
  })

  test('sync creates queues from schedule config byClipType definitions', async () => {
    // Schedule config loaded from file
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(SCHEDULE_WITH_CLIP_TYPES))

    // Sync: listProfiles + listQueues (no existing)
    mockFetch
      .mockResolvedValueOnce(fakeResponse(profilesApiBody([{ _id: 'profile-1', name: 'Test' }])))
      .mockResolvedValueOnce(fakeResponse(queuesApiBody([])))

    // 4 createQueue calls (youtube-shorts, youtube-medium-clips, tiktok-shorts, x-shorts)
    for (let i = 0; i < 4; i++) {
      mockFetch.mockResolvedValueOnce(fakeResponse(queueMutationBody(`q-${i}`, `queue-${i}`)))
    }

    // refreshQueueMappings: listProfiles + listQueues
    mockFetch
      .mockResolvedValueOnce(fakeResponse(profilesApiBody([{ _id: 'profile-1', name: 'Test' }])))
      .mockResolvedValueOnce(fakeResponse(queuesApiBody([
        { _id: 'q-yt-s', name: 'youtube-shorts' },
        { _id: 'q-yt-mc', name: 'youtube-medium-clips' },
        { _id: 'q-tt-s', name: 'tiktok-shorts' },
        { _id: 'q-x-s', name: 'x-shorts' },
      ])))
    mockWriteTextFile.mockResolvedValue(undefined)

    const result = await syncQueuesToLate()

    expect(result.created).toHaveLength(4)
    expect(result.created).toEqual(
      expect.arrayContaining(['youtube-shorts', 'youtube-medium-clips', 'tiktok-shorts', 'x-shorts']),
    )
    expect(result.errors).toHaveLength(0)
    expect(result.unchanged).toHaveLength(0)
    expect(result.deleted).toHaveLength(0)

    // twitter → x normalization
    expect(result.created).toContain('x-shorts')
    expect(result.created).not.toContain('twitter-shorts')

    // 2 (sync profile+queues) + 4 (creates) + 2 (refresh profile+queues) = 8 fetches
    expect(mockFetch).toHaveBeenCalledTimes(8)
  })

  test('sync marks unchanged queues when slots match', async () => {
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(SCHEDULE_WITH_CLIP_TYPES))

    // Sync: listProfiles
    mockFetch.mockResolvedValueOnce(fakeResponse(profilesApiBody([{ _id: 'profile-1', name: 'Test' }])))

    // listQueues: youtube-shorts already exists with matching slots (mon=1, wed=3, fri=5 at 18:00)
    mockFetch.mockResolvedValueOnce(fakeResponse(queuesApiBody([
      {
        _id: 'q-yt-s',
        name: 'youtube-shorts',
        slots: [
          { dayOfWeek: 1, time: '18:00' },
          { dayOfWeek: 3, time: '18:00' },
          { dayOfWeek: 5, time: '18:00' },
        ],
      },
    ])))

    // 3 createQueue calls for the remaining queues
    for (let i = 0; i < 3; i++) {
      mockFetch.mockResolvedValueOnce(fakeResponse(queueMutationBody(`q-new-${i}`, `new-${i}`)))
    }

    // refreshQueueMappings
    stubFetchForRefresh([{ _id: 'profile-1', name: 'Test' }], [])
    mockWriteTextFile.mockResolvedValue(undefined)

    const result = await syncQueuesToLate()

    expect(result.unchanged).toContain('youtube-shorts')
    expect(result.created).toHaveLength(3)
  })

  test('sync updates queue when slots differ', async () => {
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(SCHEDULE_WITH_CLIP_TYPES))

    // Sync: listProfiles + listQueues with different slots
    mockFetch
      .mockResolvedValueOnce(fakeResponse(profilesApiBody([{ _id: 'profile-1', name: 'Test' }])))
      .mockResolvedValueOnce(fakeResponse(queuesApiBody([
        {
          _id: 'q-yt-s',
          name: 'youtube-shorts',
          slots: [{ dayOfWeek: 0, time: '10:00' }], // Sunday 10am — differs from config
        },
      ])))

    // 1 updateQueue + 3 createQueue
    mockFetch.mockResolvedValueOnce(fakeResponse({ success: true, schedule: { _id: 'q-yt-s', name: 'youtube-shorts', slots: [] } }))
    for (let i = 0; i < 3; i++) {
      mockFetch.mockResolvedValueOnce(fakeResponse(queueMutationBody(`q-new-${i}`, `new-${i}`)))
    }

    // refreshQueueMappings
    stubFetchForRefresh([{ _id: 'profile-1', name: 'Test' }], [])
    mockWriteTextFile.mockResolvedValue(undefined)

    const result = await syncQueuesToLate()

    expect(result.updated).toContain('youtube-shorts')

    // Verify the PUT call was made with correct URL and body
    const putCall = (mockFetch.mock.calls as Array<[string, RequestInit?]>).find(
      (call) => call[1]?.method === 'PUT',
    )
    expect(putCall).toBeDefined()
    const putBody = JSON.parse(putCall![1]!.body as string)
    expect(putBody.profileId).toBe('profile-1')
    expect(putBody.queueId).toBe('q-yt-s')
    expect(putBody.name).toBe('youtube-shorts')
    expect(putBody.timezone).toBe('America/Chicago')
  })

  test('sync deletes orphan queues when deleteOrphans is true', async () => {
    const simpleConfig: ScheduleConfig = {
      timezone: 'UTC',
      platforms: {
        youtube: {
          slots: [],
          avoidDays: [],
          byClipType: {
            shorts: {
              slots: [{ days: ['mon'], time: '10:00', label: 'YT' }],
              avoidDays: [],
            },
          },
        },
      },
    }
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(simpleConfig))

    // Sync: profile + queues (one matching, one orphan)
    mockFetch
      .mockResolvedValueOnce(fakeResponse(profilesApiBody([{ _id: 'profile-1', name: 'Test' }])))
      .mockResolvedValueOnce(fakeResponse(queuesApiBody([
        { _id: 'q-yt-s', name: 'youtube-shorts', slots: [{ dayOfWeek: 1, time: '10:00' }] },
        { _id: 'q-orphan', name: 'old-platform-shorts' },
      ])))

    // deleteQueue for orphan
    mockFetch.mockResolvedValueOnce(fakeResponse({ success: true }))

    // refreshQueueMappings
    stubFetchForRefresh(
      [{ _id: 'profile-1', name: 'Test' }],
      [{ _id: 'q-yt-s', name: 'youtube-shorts' }],
    )
    mockWriteTextFile.mockResolvedValue(undefined)

    const result = await syncQueuesToLate({ deleteOrphans: true })

    expect(result.deleted).toContain('old-platform-shorts')
    expect(result.unchanged).toContain('youtube-shorts')

    // Verify DELETE call was made with correct URL
    const deleteCall = (mockFetch.mock.calls as Array<[string, RequestInit?]>).find(
      (call) => call[1]?.method === 'DELETE',
    )
    expect(deleteCall).toBeDefined()
    expect(deleteCall![0]).toContain('profileId=profile-1')
    expect(deleteCall![0]).toContain('queueId=q-orphan')
  })

  test('sync does not delete orphans when deleteOrphans is false', async () => {
    const simpleConfig: ScheduleConfig = {
      timezone: 'UTC',
      platforms: {
        youtube: {
          slots: [],
          avoidDays: [],
          byClipType: {
            shorts: {
              slots: [{ days: ['mon'], time: '10:00', label: 'YT' }],
              avoidDays: [],
            },
          },
        },
      },
    }
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(simpleConfig))

    // Sync: profile + queues (matching + orphan)
    mockFetch
      .mockResolvedValueOnce(fakeResponse(profilesApiBody([{ _id: 'profile-1', name: 'Test' }])))
      .mockResolvedValueOnce(fakeResponse(queuesApiBody([
        { _id: 'q-yt-s', name: 'youtube-shorts', slots: [{ dayOfWeek: 1, time: '10:00' }] },
        { _id: 'q-orphan', name: 'orphan-queue' },
      ])))

    // refreshQueueMappings
    stubFetchForRefresh([{ _id: 'profile-1', name: 'Test' }], [])
    mockWriteTextFile.mockResolvedValue(undefined)

    const result = await syncQueuesToLate({ deleteOrphans: false })

    expect(result.deleted).toHaveLength(0)
    // No DELETE method calls
    const deleteCalls = (mockFetch.mock.calls as Array<[string, RequestInit?]>).filter(
      (call) => call[1]?.method === 'DELETE',
    )
    expect(deleteCalls).toHaveLength(0)
  })

  test('dry run does not call API mutation methods', async () => {
    const simpleConfig: ScheduleConfig = {
      timezone: 'UTC',
      platforms: {
        tiktok: {
          slots: [],
          avoidDays: [],
          byClipType: {
            shorts: {
              slots: [{ days: ['mon'], time: '10:00', label: 'TT' }],
              avoidDays: [],
            },
          },
        },
      },
    }
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(simpleConfig))

    // Sync: profile + queues (has an orphan)
    mockFetch
      .mockResolvedValueOnce(fakeResponse(profilesApiBody([{ _id: 'profile-1', name: 'Test' }])))
      .mockResolvedValueOnce(fakeResponse(queuesApiBody([
        { _id: 'q-orphan', name: 'old-queue' },
      ])))

    // Dry run — NO refreshQueueMappings, NO mutation calls

    const result = await syncQueuesToLate({ dryRun: true, deleteOrphans: true })

    expect(result.created).toContain('tiktok-shorts')
    expect(result.deleted).toContain('old-queue')

    // Only 2 fetch calls: listProfiles + listQueues (reads only)
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // No POST, PUT, DELETE calls
    const mutationCalls = (mockFetch.mock.calls as Array<[string, RequestInit?]>).filter(
      (call) => {
        const method = call[1]?.method
        return method === 'POST' || method === 'PUT' || method === 'DELETE'
      },
    )
    expect(mutationCalls).toHaveLength(0)
  })

  test('sync throws when no profiles found', async () => {
    const simpleConfig: ScheduleConfig = {
      timezone: 'UTC',
      platforms: {
        youtube: {
          slots: [],
          avoidDays: [],
          byClipType: {
            shorts: {
              slots: [{ days: ['mon'], time: '10:00', label: 'YT' }],
              avoidDays: [],
            },
          },
        },
      },
    }
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(simpleConfig))

    // Real L2 client returns empty profiles
    mockFetch.mockResolvedValueOnce(fakeResponse(profilesApiBody([])))

    await expect(syncQueuesToLate()).rejects.toThrow('No Late API profiles found')
  })

  test('sync records errors for individual queue creation failures', async () => {
    const simpleConfig: ScheduleConfig = {
      timezone: 'UTC',
      platforms: {
        youtube: {
          slots: [],
          avoidDays: [],
          byClipType: {
            shorts: {
              slots: [{ days: ['mon'], time: '10:00', label: 'YT' }],
              avoidDays: [],
            },
          },
        },
        tiktok: {
          slots: [],
          avoidDays: [],
          byClipType: {
            shorts: {
              slots: [{ days: ['mon'], time: '10:00', label: 'TT' }],
              avoidDays: [],
            },
          },
        },
      },
    }
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(simpleConfig))

    // Sync: listProfiles + listQueues (no existing)
    mockFetch
      .mockResolvedValueOnce(fakeResponse(profilesApiBody([{ _id: 'profile-1', name: 'Test' }])))
      .mockResolvedValueOnce(fakeResponse(queuesApiBody([])))

    // First createQueue succeeds, second returns 500 error
    mockFetch
      .mockResolvedValueOnce(fakeResponse(queueMutationBody('q-ok', 'youtube-shorts')))
      .mockResolvedValueOnce(fakeErrorResponse(500, 'Rate limit exceeded'))

    // refreshQueueMappings
    stubFetchForRefresh([{ _id: 'profile-1', name: 'Test' }], [])
    mockWriteTextFile.mockResolvedValue(undefined)

    const result = await syncQueuesToLate()

    // One succeeded, one failed
    expect(result.created.length + result.errors.length).toBe(2)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toContain('500')
  })

  test('platforms without byClipType are skipped in queue creation', async () => {
    const configNoByCT: ScheduleConfig = {
      timezone: 'UTC',
      platforms: {
        youtube: {
          slots: [{ days: ['mon'], time: '10:00', label: 'Default' }],
          avoidDays: [],
          // No byClipType — should NOT produce any queues
        },
      },
    }
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(configNoByCT))

    // Sync: listProfiles + listQueues
    mockFetch
      .mockResolvedValueOnce(fakeResponse(profilesApiBody([{ _id: 'profile-1', name: 'Test' }])))
      .mockResolvedValueOnce(fakeResponse(queuesApiBody([])))

    // refreshQueueMappings
    stubFetchForRefresh([{ _id: 'profile-1', name: 'Test' }], [])
    mockWriteTextFile.mockResolvedValue(undefined)

    const result = await syncQueuesToLate()

    expect(result.created).toHaveLength(0)
    expect(result.unchanged).toHaveLength(0)

    // No POST calls for queue creation
    const postCalls = (mockFetch.mock.calls as Array<[string, RequestInit?]>).filter(
      (call) => call[1]?.method === 'POST',
    )
    expect(postCalls).toHaveLength(0)
  })
})

describe('L3 Integration: queueMapping + queueSync end-to-end', () => {
  beforeEach(async () => {
    await clearQueueCache()
    clearScheduleCache()
    vi.clearAllMocks()
  })

  test('sync creates queues then mapping resolves them', async () => {
    const simpleConfig: ScheduleConfig = {
      timezone: 'UTC',
      platforms: {
        youtube: {
          slots: [],
          avoidDays: [],
          byClipType: {
            shorts: {
              slots: [{ days: ['mon'], time: '10:00', label: 'YT' }],
              avoidDays: [],
            },
          },
        },
        instagram: {
          slots: [],
          avoidDays: [],
          byClipType: {
            shorts: {
              slots: [{ days: ['tue'], time: '14:00', label: 'IG' }],
              avoidDays: [],
            },
          },
        },
      },
    }

    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(simpleConfig))

    // Sync: listProfiles + listQueues (empty)
    mockFetch
      .mockResolvedValueOnce(fakeResponse(profilesApiBody([{ _id: 'profile-1', name: 'Test' }])))
      .mockResolvedValueOnce(fakeResponse(queuesApiBody([])))

    // 2 createQueue calls
    mockFetch
      .mockResolvedValueOnce(fakeResponse(queueMutationBody('q-yt-s', 'youtube-shorts')))
      .mockResolvedValueOnce(fakeResponse(queueMutationBody('q-ig-s', 'instagram-shorts')))

    // refreshQueueMappings: returns the newly created queues
    mockFetch
      .mockResolvedValueOnce(fakeResponse(profilesApiBody([{ _id: 'profile-1', name: 'Test' }])))
      .mockResolvedValueOnce(fakeResponse(queuesApiBody([
        { _id: 'q-yt-s', name: 'youtube-shorts' },
        { _id: 'q-ig-s', name: 'instagram-shorts' },
      ])))
    mockWriteTextFile.mockResolvedValue(undefined)

    const syncResult = await syncQueuesToLate()
    expect(syncResult.created).toHaveLength(2)

    // getQueueId resolves from memory cache (populated by refreshQueueMappings)
    const ytQueueId = await getQueueId('youtube', 'shorts')
    const igQueueId = await getQueueId('instagram', 'shorts')

    expect(ytQueueId).toBe('q-yt-s')
    expect(igQueueId).toBe('q-ig-s')

    // No additional fetch calls after sync — data was cached
    // Total: 2 (sync reads) + 2 (creates) + 2 (refresh reads) = 6
    expect(mockFetch).toHaveBeenCalledTimes(6)
  })

  test('cache refresh after sync writes file cache for persistence', async () => {
    const simpleConfig: ScheduleConfig = {
      timezone: 'UTC',
      platforms: {
        linkedin: {
          slots: [],
          avoidDays: [],
          byClipType: {
            shorts: {
              slots: [{ days: ['wed'], time: '09:00', label: 'LI' }],
              avoidDays: [],
            },
          },
        },
      },
    }

    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(simpleConfig))

    // Sync: listProfiles + listQueues + createQueue
    mockFetch
      .mockResolvedValueOnce(fakeResponse(profilesApiBody([{ _id: 'profile-1', name: 'Main' }])))
      .mockResolvedValueOnce(fakeResponse(queuesApiBody([])))
      .mockResolvedValueOnce(fakeResponse(queueMutationBody('q-li-s', 'linkedin-shorts')))

    // refreshQueueMappings
    mockFetch
      .mockResolvedValueOnce(fakeResponse(profilesApiBody([{ _id: 'profile-1', name: 'Main' }])))
      .mockResolvedValueOnce(fakeResponse(queuesApiBody([
        { _id: 'q-li-s', name: 'linkedin-shorts' },
      ])))
    mockWriteTextFile.mockResolvedValue(undefined)

    await syncQueuesToLate()

    // Verify file cache was written with queue data
    expect(mockWriteTextFile).toHaveBeenCalledWith(
      expect.stringContaining('.vidpipe-queue-cache.json'),
      expect.stringContaining('linkedin-shorts'),
    )

    // Parse the written cache to verify structure
    const writtenJson = mockWriteTextFile.mock.calls.find(
      (call: string[]) => call[0].includes('.vidpipe-queue-cache.json'),
    )
    expect(writtenJson).toBeDefined()
    const writtenCache = JSON.parse(writtenJson![1])
    expect(writtenCache.mappings['linkedin-shorts']).toBe('q-li-s')
    expect(writtenCache.profileId).toBe('profile-1')
    expect(writtenCache.fetchedAt).toBeDefined()
  })
})
