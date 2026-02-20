import { Router } from '../../L1-infra/http/http.js'
import { getPendingItems, getGroupedPendingItems, getItem, updateItem, rejectItem } from '../../L3-services/postStore/postStore.js'
import { findNextSlot, getScheduleCalendar } from '../../L3-services/scheduler/scheduler.js'
import { createLateApiClient, type LateApiClient, type LateAccount, type LateProfile } from '../../L3-services/lateApi/lateApiService.js'
import { normalizePlatformString } from '../../L0-pure/types/index.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { enqueueApproval } from './approvalQueue.js'

// ── Simple in-memory cache (avoids repeated Late API calls) ────────────
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const cache = new Map<string, { data: unknown; expiry: number }>()

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key)
  if (entry && entry.expiry > Date.now()) return entry.data as T
  cache.delete(key)
  return undefined
}

function setCache(key: string, data: unknown, ttl = CACHE_TTL_MS): void {
  cache.set(key, { data, expiry: Date.now() + ttl })
}

export function createRouter(): Router {
  const router = Router()

  // GET /api/posts/pending — list all pending review items
  router.get('/api/posts/pending', async (req, res) => {
    const items = await getPendingItems()
    res.json({ items, total: items.length })
  })

  // GET /api/posts/grouped — list pending items grouped by video/clip
  router.get('/api/posts/grouped', async (req, res) => {
    const groups = await getGroupedPendingItems()
    res.json({ groups, total: groups.length })
  })

  // GET /api/init — combined endpoint for initial page load (1 request instead of 3)
  router.get('/api/init', async (req, res) => {
    const [groupsResult, accountsResult, profileResult] = await Promise.allSettled([
      getGroupedPendingItems(),
      (async () => {
        const cached = getCached<LateAccount[]>('accounts')
        if (cached) return cached
        const client = createLateApiClient()
        const accounts = await client.listAccounts()
        setCache('accounts', accounts)
        return accounts
      })(),
      (async () => {
        const cached = getCached<LateProfile | null>('profile')
        if (cached !== undefined) return cached
        const client = createLateApiClient()
        const profiles = await client.listProfiles()
        const profile = profiles[0] || null
        setCache('profile', profile)
        return profile
      })(),
    ])

    const groups = groupsResult.status === 'fulfilled' ? groupsResult.value : []
    const accounts = accountsResult.status === 'fulfilled' ? accountsResult.value : []
    const profile = profileResult.status === 'fulfilled' ? profileResult.value : null

    res.json({ groups, total: groups.length, accounts, profile })
  })

  // GET /api/posts/:id — get single post with full content
  router.get('/api/posts/:id', async (req, res) => {
    const item = await getItem(req.params.id)
    if (!item) return res.status(404).json({ error: 'Item not found' })
    res.json(item)
  })

  // POST /api/posts/:id/approve — enqueue for sequential processing, return 202
  router.post('/api/posts/:id/approve', (req, res) => {
    const itemId = req.params.id

    res.status(202).json({ accepted: true })

    enqueueApproval([itemId]).then(result => {
      if (result.scheduled > 0) {
        logger.info(`Single approve completed: ${String(itemId).replace(/[\r\n]/g, '')} → ${result.results[0]?.scheduledFor}`)
      } else {
        logger.error(`Single approve failed: ${String(itemId).replace(/[\r\n]/g, '')}: ${result.results[0]?.error}`)
      }
    }).catch(() => {})
  })

  // POST /api/posts/bulk-approve — fire-and-forget: returns 202 immediately, processes sequentially in queue
  router.post('/api/posts/bulk-approve', (req, res) => {
    const { itemIds } = req.body
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds must be a non-empty array' })
    }

    res.status(202).json({ accepted: true, count: itemIds.length })

    enqueueApproval(itemIds).catch(err => {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`Bulk approve background failed: ${String(msg).replace(/[\r\n]/g, '')}`)
    })
  })

  // POST /api/posts/:id/reject — delete from queue
  router.post('/api/posts/:id/reject', async (req, res) => {
    try {
      await rejectItem(req.params.id)
      res.json({ success: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: msg })
    }
  })

  // POST /api/posts/bulk-reject — fire-and-forget: returns 202 immediately, deletes in background
  router.post('/api/posts/bulk-reject', (req, res) => {
    const { itemIds } = req.body
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds must be a non-empty array' })
    }

    res.status(202).json({ accepted: true, count: itemIds.length })

    // Process in background
    ;(async () => {
      let succeeded = 0
      for (const itemId of itemIds) {
        try {
          await rejectItem(itemId)
          succeeded++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logger.error(`Bulk reject failed for ${String(itemId).replace(/[\r\n]/g, '')}: ${String(msg).replace(/[\r\n]/g, '')}`)
        }
      }
      logger.info(`Bulk reject completed: ${succeeded} of ${itemIds.length} removed`)
    })()
  })

  // PUT /api/posts/:id — edit post content
  router.put('/api/posts/:id', async (req, res) => {
    try {
      const { postContent, metadata } = req.body
      const updated = await updateItem(req.params.id, { postContent, metadata })
      if (!updated) return res.status(404).json({ error: 'Item not found' })
      res.json(updated)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: msg })
    }
  })

  // GET /api/schedule — current schedule calendar
  router.get('/api/schedule', async (req, res) => {
    try {
      const calendar = await getScheduleCalendar()
      res.json({ slots: calendar })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: msg })
    }
  })

  // GET /api/schedule/next-slot/:platform — calculate next available slot
  router.get('/api/schedule/next-slot/:platform', async (req, res) => {
    try {
      const normalized = normalizePlatformString(req.params.platform)
      const clipType = typeof req.query.clipType === 'string' ? req.query.clipType : undefined
      const slot = await findNextSlot(normalized, clipType)
      res.json({ platform: normalized, nextSlot: slot })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: msg })
    }
  })

  // GET /api/accounts — list connected Late accounts (cached)
  router.get('/api/accounts', async (req, res) => {
    try {
      const cached = getCached<LateAccount[]>('accounts')
      if (cached) return res.json({ accounts: cached })

      const client = createLateApiClient()
      const accounts = await client.listAccounts()
      setCache('accounts', accounts)
      res.json({ accounts })
    } catch (err) {
      res.status(500).json({ accounts: [], error: err instanceof Error ? err.message : 'Failed to fetch accounts' })
    }
  })

  // GET /api/profile — get Late profile info (cached)
  router.get('/api/profile', async (req, res) => {
    try {
      const cached = getCached<LateProfile | null>('profile')
      if (cached !== undefined) return res.json({ profile: cached })

      const client = createLateApiClient()
      const profiles = await client.listProfiles()
      const profile = profiles[0] || null
      setCache('profile', profile)
      res.json({ profile })
    } catch (err) {
      res.status(500).json({ profile: null, error: err instanceof Error ? err.message : 'Failed to fetch profile' })
    }
  })

  return router
}
