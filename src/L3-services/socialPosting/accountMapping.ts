import { Platform } from '../../L0-pure/types/index.js'
import {
  clearAccountCache as clearStoredAccountCache,
  getCachedAccounts,
  setCachedAccounts,
} from '../../L2-clients/dataStore/accountCacheStore.js'
import { LateApiClient } from '../../L2-clients/late/lateApi.js'
import type { LateAccount } from '../../L2-clients/late/lateApi.js'
import logger from '../../L1-infra/logger/configLogger.js'

// ── Cache ──────────────────────────────────────────────────────────────

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

  try {
    setCachedAccounts(mapping)
  } catch (err) {
    logger.warn('Failed to persist account cache', { error: err })
  }

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

  // 2. Database cache
  try {
    const cachedAccounts = getCachedAccounts(CACHE_TTL_MS)
    if (cachedAccounts) {
      memoryCache = {
        accounts: cachedAccounts,
        fetchedAt: new Date().toISOString(),
      }
      return cachedAccounts
    }
  } catch {
    // Fall through to API fetch when the datastore cache is unavailable.
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
 * 2. Database cache
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
 * Clear the account cache (both memory and database).
 */
export async function clearAccountCache(): Promise<void> {
  memoryCache = null
  try {
    clearStoredAccountCache()
  } catch {
    // Ignore cache clear failures to keep cache invalidation best-effort.
  }
}
