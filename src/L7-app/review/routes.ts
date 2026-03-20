import { Router } from '../../L1-infra/http/http.js'
import {
  getPendingItems,
  getGroupedPendingItems,
  getItem,
  updateItem,
  rejectItem,
  type GroupedQueueItem,
  type QueueItem,
} from '../../L3-services/postStore/postStore.js'
import { getIdeasByIds } from '../../L3-services/ideation/ideaService.js'
import { createLateApiClient, type LateApiClient, type LateAccount, type LateProfile } from '../../L3-services/lateApi/lateApiService.js'
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

type ReviewQueueItem = QueueItem & { ideaPublishBy?: string }
type ReviewGroupedQueueItem = Omit<GroupedQueueItem, 'items'> & { items: ReviewQueueItem[] }

async function getEarliestPublishBy(ideaIds: string[]): Promise<string | undefined> {
  try {
    const ideas = await getIdeasByIds(ideaIds)
    const publishByDates = ideas
      .map((idea) => idea.publishBy)
      .filter((publishBy): publishBy is string => Boolean(publishBy))
      .sort()
    return publishByDates[0]
  } catch {
    return undefined
  }
}

async function enrichQueueItem(item: QueueItem): Promise<ReviewQueueItem> {
  const ideaPublishBy = item.metadata.ideaIds?.length
    ? await getEarliestPublishBy(item.metadata.ideaIds)
    : undefined

  return {
    ...item,
    ...(ideaPublishBy ? { ideaPublishBy } : {}),
  }
}

async function enrichQueueItems(items: QueueItem[]): Promise<ReviewQueueItem[]> {
  const allIdeaIds = new Set<string>()
  for (const item of items) {
    if (item.metadata.ideaIds?.length) {
      for (const ideaId of item.metadata.ideaIds) {
        allIdeaIds.add(ideaId)
      }
    }
  }

  let publishByMap = new Map<string, string | undefined>()
  if (allIdeaIds.size > 0) {
    try {
      const ideas = await getIdeasByIds([...allIdeaIds])
      for (const idea of ideas) {
        publishByMap.set(idea.id, idea.publishBy)
        publishByMap.set(String(idea.issueNumber), idea.publishBy)
      }
    } catch {
      // Silently degrade — no publishBy enrichment
    }
  }

  return items.map((item) => {
    if (!item.metadata.ideaIds?.length) return { ...item }

    const dates = item.metadata.ideaIds
      .map((id) => publishByMap.get(id))
      .filter((publishBy): publishBy is string => Boolean(publishBy))
      .sort()
    const ideaPublishBy = dates[0]
    return ideaPublishBy ? { ...item, ideaPublishBy } : { ...item }
  })
}

async function enrichGroupedQueueItems(groups: GroupedQueueItem[]): Promise<ReviewGroupedQueueItem[]> {
  return Promise.all(groups.map(async (group) => ({
    ...group,
    items: await enrichQueueItems(group.items),
  })))
}

export function createRouter(): Router {
  const router = Router()

  // GET /api/posts/pending — list all pending review items
  router.get('/api/posts/pending', async (req, res) => {
    const items = await enrichQueueItems(await getPendingItems())
    res.json({ items, total: items.length })
  })

  // GET /api/posts/grouped — list pending items grouped by video/clip
  router.get('/api/posts/grouped', async (req, res) => {
    const groups = await enrichGroupedQueueItems(await getGroupedPendingItems())
    res.json({ groups, total: groups.length })
  })

  // GET /api/init — combined endpoint for initial page load (1 request instead of 3)
  router.get('/api/init', async (req, res) => {
    const [groupsResult, accountsResult, profileResult] = await Promise.allSettled([
      (async () => enrichGroupedQueueItems(await getGroupedPendingItems()))(),
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
    res.json(await enrichQueueItem(item))
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

  // GET /api/schedule — current schedule calendar (via Late API)
  router.get('/api/schedule', async (req, res) => {
    try {
      const client = createLateApiClient()
      const posts = await client.getScheduledPosts()
      const slots = posts
        .filter(p => p.scheduledFor)
        .map(p => ({
          platform: p.platforms[0]?.platform ?? 'unknown',
          scheduledFor: p.scheduledFor!,
          source: 'late' as const,
          postId: p._id,
        }))
      slots.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
      res.json({ slots })
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
