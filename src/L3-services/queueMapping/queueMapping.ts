/**
 * Queue mapping service — resolves (platform, clipType) → Late API queueId.
 *
 * Queue names follow the convention: {platform}-{clipType}
 * e.g. "youtube-shorts", "x-medium", "instagram-shorts"
 *
 * Uses the same memory + file cache pattern as accountMapping.ts with a 24hr TTL.
 */
import { LateApiClient } from '../../L2-clients/late/lateApi.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { readTextFile, writeTextFile, removeFile } from '../../L1-infra/fileSystem/fileSystem.js'
import { join, resolve, sep } from '../../L1-infra/paths/paths.js'

// ── Cache ──────────────────────────────────────────────────────────────

const CACHE_FILE = '.vidpipe-queue-cache.json'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

interface QueueCache {
  mappings: Record<string, string> // queueName → queueId
  profileId: string
  fetchedAt: string
}

let memoryCache: QueueCache | null = null

// ── Helpers ────────────────────────────────────────────────────────────

function cachePath(): string {
  return join(process.cwd(), CACHE_FILE)
}

function isCacheValid(cache: QueueCache): boolean {
  const fetchedAtTime = new Date(cache.fetchedAt).getTime()
  if (Number.isNaN(fetchedAtTime)) {
    logger.warn('Invalid fetchedAt in queue cache; treating as stale', {
      fetchedAt: cache.fetchedAt,
    })
    return false
  }
  const age = Date.now() - fetchedAtTime
  return age < CACHE_TTL_MS
}

async function readFileCache(): Promise<QueueCache | null> {
  try {
    const raw = await readTextFile(cachePath())
    const cache = JSON.parse(raw) as QueueCache
    if (cache.mappings && cache.profileId && cache.fetchedAt && isCacheValid(cache)) {
      return cache
    }
    return null
  } catch {
    return null
  }
}

async function writeFileCache(cache: QueueCache): Promise<void> {
  try {
    if (!cache || typeof cache !== 'object' || !cache.mappings || !cache.profileId || !cache.fetchedAt) {
      logger.warn('Invalid queue cache structure, skipping write')
      return
    }
    const sanitized: QueueCache = {
      mappings: typeof cache.mappings === 'object' ? { ...cache.mappings } : {},
      profileId: String(cache.profileId),
      fetchedAt: String(cache.fetchedAt),
    }
    // Validate HTTP-sourced data before writing to cache
    for (const [name, id] of Object.entries(sanitized.mappings)) {
      if (typeof name !== 'string' || typeof id !== 'string' ||
          /[\x00-\x1f]/.test(name) || /[\x00-\x1f]/.test(id)) {
        logger.warn('Invalid queue mapping data from API, skipping cache write')
        return
      }
    }
    const resolvedCachePath = resolve(cachePath())
    if (!resolvedCachePath.startsWith(resolve(process.cwd()) + sep)) {
      throw new Error('Cache path outside working directory')
    }
    await writeTextFile(resolvedCachePath, JSON.stringify(sanitized, null, 2))
  } catch (err) {
    logger.warn('Failed to write queue cache file', { error: err })
  }
}

async function fetchAndCache(): Promise<QueueCache> {
  const client = new LateApiClient()

  // Get the first profile to use as the queue owner
  const profiles = await client.listProfiles()
  if (profiles.length === 0) {
    logger.warn('No Late API profiles found — queue mappings will be empty')
    const emptyCache: QueueCache = {
      mappings: {},
      profileId: '',
      fetchedAt: new Date().toISOString(),
    }
    memoryCache = emptyCache
    return emptyCache
  }
  const profileId = profiles[0]._id

  // Fetch all queues (including inactive)
  const { queues } = await client.listQueues(profileId, true)

  if (queues.length === 0) {
    logger.warn(
      'No queues found in Late API — run `vidpipe sync-queues` to create platform queues',
    )
  }

  const mappings: Record<string, string> = {}
  for (const queue of queues) {
    mappings[queue.name] = queue._id
  }

  const cache: QueueCache = {
    mappings,
    profileId,
    fetchedAt: new Date().toISOString(),
  }
  memoryCache = cache
  await writeFileCache(cache)

  logger.info('Refreshed Late queue mappings', {
    queueCount: queues.length,
    queues: Object.keys(mappings),
  })
  return cache
}

async function ensureMappings(): Promise<QueueCache> {
  // 1. In-memory cache
  if (memoryCache && isCacheValid(memoryCache)) {
    return memoryCache
  }

  // 2. File cache
  const fileCache = await readFileCache()
  if (fileCache) {
    memoryCache = fileCache
    return fileCache
  }

  // 3. Fetch from Late API
  try {
    return await fetchAndCache()
  } catch (err) {
    logger.error('Failed to fetch Late queue mappings', { error: err })
    return { mappings: {}, profileId: '', fetchedAt: new Date().toISOString() }
  }
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Get the Late API queue ID for a platform+clipType combination.
 *
 * Queue names follow the convention: `{platform}-{clipType}`
 * Platform normalization: 'twitter' → 'x' for queue names.
 *
 * @returns The queue ID, or null if no matching queue exists.
 */
export async function getQueueId(platform: string, clipType: string): Promise<string | null> {
  const cache = await ensureMappings()
  // Late API uses 'twitter', but queue names use 'x'
  const normalizedPlatform = platform === 'twitter' ? 'x' : platform
  const queueName = `${normalizedPlatform}-${clipType}`
  return cache.mappings[queueName] ?? null
}

/**
 * Get the cached profile ID from the queue cache.
 * Fetches from Late API if not cached.
 */
export async function getProfileId(): Promise<string> {
  const cache = await ensureMappings()
  return cache.profileId
}

/**
 * Get all queue mappings (queueName → queueId).
 * Fetches from Late API if not cached.
 */
export async function getAllQueueMappings(): Promise<Record<string, string>> {
  const cache = await ensureMappings()
  return { ...cache.mappings }
}

/**
 * Force refresh queue mappings from Late API, bypassing all caches.
 */
export async function refreshQueueMappings(): Promise<Record<string, string>> {
  memoryCache = null
  const cache = await fetchAndCache()
  return { ...cache.mappings }
}

/**
 * Clear the queue cache (both memory and file).
 */
export async function clearQueueCache(): Promise<void> {
  memoryCache = null
  try {
    await removeFile(cachePath())
  } catch {
    // File may not exist — that's fine
  }
}
