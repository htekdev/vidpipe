import { Platform } from '../types/index.js'
import { LateApiClient } from './lateApi.js'
import type { LateAccount } from './lateApi.js'
import logger from '../config/logger.js'
import { readTextFile, writeTextFile, removeFile } from '../core/fileSystem.js'
import { join, resolve, sep } from '../core/paths.js'

// ── Cache ──────────────────────────────────────────────────────────────

const CACHE_FILE = '.vidpipe-cache.json'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

interface AccountCache {
  accounts: Record<string, string> // platform -> accountId
  fetchedAt: string
}

let memoryCache: AccountCache | null = null

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Map a vidpipe Platform to the Late API platform string.
 */
function toLatePlatform(platform: Platform): string {
  return platform === Platform.X ? 'twitter' : platform
}

function cachePath(): string {
  return join(process.cwd(), CACHE_FILE)
}

function isCacheValid(cache: AccountCache): boolean {
  const fetchedAtTime = new Date(cache.fetchedAt).getTime()
  if (Number.isNaN(fetchedAtTime)) {
    logger.warn('Invalid fetchedAt in account cache; treating as stale', {
      fetchedAt: cache.fetchedAt,
    })
    return false
  }
  const age = Date.now() - fetchedAtTime
  return age < CACHE_TTL_MS
}

async function readFileCache(): Promise<AccountCache | null> {
  try {
    const raw = await readTextFile(cachePath())
    const cache = JSON.parse(raw) as AccountCache
    if (cache.accounts && cache.fetchedAt && isCacheValid(cache)) {
      return cache
    }
    return null
  } catch {
    return null
  }
}

async function writeFileCache(cache: AccountCache): Promise<void> {
  try {
    // Validate cache structure before writing to prevent malformed data
    if (!cache || typeof cache !== 'object' || !cache.accounts || !cache.fetchedAt) {
      logger.warn('Invalid cache structure, skipping write')
      return
    }
    // Sanitize by re-constructing with only expected fields
    const sanitized: AccountCache = {
      accounts: typeof cache.accounts === 'object' ? { ...cache.accounts } : {},
      fetchedAt: String(cache.fetchedAt),
    }
    // Validate HTTP-sourced account data before writing to cache (CodeQL js/http-to-file-access)
    for (const [platform, accountId] of Object.entries(sanitized.accounts)) {
      if (typeof platform !== 'string' || typeof accountId !== 'string' ||
          /[\x00-\x1f]/.test(platform) || /[\x00-\x1f]/.test(accountId)) {
        logger.warn('Invalid account mapping data from API, skipping cache write')
        return
      }
    }
    const resolvedCachePath = resolve(cachePath())
    if (!resolvedCachePath.startsWith(resolve(process.cwd()) + sep)) {
      throw new Error('Cache path outside working directory')
    }
    // lgtm[js/http-to-file-access] - Writing sanitized account cache is intended functionality with path validation
    await writeTextFile(resolvedCachePath, JSON.stringify(sanitized, null, 2))
  } catch (err) {
    logger.warn('Failed to write account cache file', { error: err })
  }
}

async function fetchAndCache(): Promise<Record<string, string>> {
  const client = new LateApiClient()
  const accounts: LateAccount[] = await client.listAccounts()

  const mapping: Record<string, string> = {}
  for (const acct of accounts) {
    if (acct.isActive) {
      mapping[acct.platform] = acct._id
    }
  }

  const cache: AccountCache = {
    accounts: mapping,
    fetchedAt: new Date().toISOString(),
  }
  memoryCache = cache
  await writeFileCache(cache)

  logger.info('Refreshed Late account mappings', {
    platforms: Object.keys(mapping),
  })
  return mapping
}

async function ensureMappings(): Promise<Record<string, string>> {
  // 1. In-memory cache
  if (memoryCache && isCacheValid(memoryCache)) {
    return memoryCache.accounts
  }

  // 2. File cache
  const fileCache = await readFileCache()
  if (fileCache) {
    memoryCache = fileCache
    return fileCache.accounts
  }

  // 3. Fetch from Late API
  try {
    return await fetchAndCache()
  } catch (err) {
    logger.error('Failed to fetch Late account mappings', { error: err })
    return {}
  }
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Get the Late account ID for a given platform.
 *
 * Resolution order:
 * 1. In-memory cache
 * 2. File cache (.vidpipe-cache.json)
 * 3. Fetch from Late API and cache
 *
 * Returns null if the platform is not connected.
 */
export async function getAccountId(
  platform: Platform,
): Promise<string | null> {
  const mappings = await ensureMappings()
  const latePlatform = toLatePlatform(platform)
  return mappings[latePlatform] ?? null
}

/**
 * Get all account mappings (platform -> accountId).
 * Fetches from Late API if not cached.
 */
export async function getAllAccountMappings(): Promise<
  Record<string, string>
> {
  return ensureMappings()
}

/**
 * Force refresh the account mappings from Late API.
 */
export async function refreshAccountMappings(): Promise<
  Record<string, string>
> {
  memoryCache = null
  return fetchAndCache()
}

/**
 * Clear the account cache (both memory and file).
 */
export async function clearAccountCache(): Promise<void> {
  memoryCache = null
  try {
    await removeFile(cachePath())
  } catch {
    // File may not exist — that's fine
  }
}
