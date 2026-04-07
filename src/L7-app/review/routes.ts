import { Router } from '../../L1-infra/http/http.js'
import {
  listPendingItems,
  getGroupedItems,
  getItemById,
  updateItem as azureUpdateItem,
  rejectItem as azureRejectItem,
  getMediaStream,
  type ReviewItem,
  type ReviewGroup,
} from '../../L3-services/azureStorage/azureReviewDataSource.js'
import { getContentItems } from '../../L3-services/azureStorage/azureStorageService.js'
import { getIdeasByIds } from '../../L3-services/ideation/ideaService.js'
import { findNextSlot, getScheduleCalendar } from '../../L3-services/scheduler/scheduler.js'
import { createLateApiClient, type LateApiClient, type LateAccount, type LateProfile } from '../../L3-services/lateApi/lateApiService.js'
import { normalizePlatformString } from '../../L0-pure/types/index.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { getQueueId, getProfileId } from '../../L3-services/queueMapping/queueMapping.js'
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

type ReviewQueueItem = ReviewItem & { ideaPublishBy?: string }
type ReviewGroupedItem = ReviewGroup & { items: ReviewQueueItem[] }

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

async function enrichReviewItem(item: ReviewItem): Promise<ReviewQueueItem> {
  const ideaPublishBy = item.ideaIds?.length
    ? await getEarliestPublishBy(item.ideaIds)
    : undefined

  return {
    ...item,
    ...(ideaPublishBy ? { ideaPublishBy } : {}),
  }
}

async function enrichReviewItems(items: ReviewItem[]): Promise<ReviewQueueItem[]> {
  const allIdeaIds = new Set<string>()
  for (const item of items) {
    if (item.ideaIds?.length) {
      for (const ideaId of item.ideaIds) {
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
    if (!item.ideaIds?.length) return { ...item }

    const dates = item.ideaIds
      .map((id) => publishByMap.get(id))
      .filter((publishBy): publishBy is string => Boolean(publishBy))
      .sort()
    const ideaPublishBy = dates[0]
    return ideaPublishBy ? { ...item, ideaPublishBy } : { ...item }
  })
}

async function enrichGroupedItems(groups: ReviewGroup[]): Promise<ReviewGroupedItem[]> {
  return Promise.all(groups.map(async (group) => {
    const firstItem = group.items[0]
    const hasMedia = group.items.some(item => Boolean(item.mediaFilename))
    return {
      ...group,
      groupKey: group.videoSlug,
      hasMedia,
      mediaType: firstItem?.mediaType || 'video',
      items: await enrichReviewItems(group.items),
    }
  }))
}

export function createRouter(): Router {
  const router = Router()

  // GET /api/media/:itemId/:filename — proxy media from Azure blob storage
  router.get('/api/media/:itemId/:filename', async (req, res) => {
    try {
      const { itemId, filename } = req.params
      const { stream, contentType } = await getMediaStream(itemId, filename)
      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'public, max-age=3600')
      stream.pipe(res)
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error' })
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!res.headersSent) {
        res.status(404).json({ error: msg })
      }
    }
  })

  // GET /api/posts/pending — list all pending review items
  router.get('/api/posts/pending', async (req, res) => {
    const items = await enrichReviewItems(await listPendingItems())
    res.json({ items, total: items.length })
  })

  // GET /api/posts/grouped — list pending items grouped by video/clip
  router.get('/api/posts/grouped', async (req, res) => {
    const groups = await enrichGroupedItems(await getGroupedItems())
    res.json({ groups, total: groups.length })
  })

  // GET /api/init — combined endpoint for initial page load (1 request instead of 3)
  router.get('/api/init', async (req, res) => {
    const [groupsResult, accountsResult, profileResult] = await Promise.allSettled([
      (async () => enrichGroupedItems(await getGroupedItems()))(),
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
    // Look up the item across all video slugs
    const allItems = await getContentItems()
    const match = allItems.find(r => r.rowKey === req.params.id)
    if (!match) return res.status(404).json({ error: 'Item not found' })

    const item = await getItemById(match.partitionKey, match.rowKey)
    if (!item) return res.status(404).json({ error: 'Item not found' })
    res.json(await enrichReviewItem(item))
  })

  // POST /api/posts/:id/approve — enqueue for sequential processing, return 202
  // Query param ?priority=true to shift existing queue posts and schedule first
  router.post('/api/posts/:id/approve', (req, res) => {
    const itemId = req.params.id
    const priority = req.query.priority === 'true' || req.body?.priority === true

    res.status(202).json({ accepted: true })

    enqueueApproval([itemId], { priority }).then(result => {
      if (result.scheduled > 0) {
        logger.info(`Single approve completed: ${String(itemId).replace(/[\r\n]/g, '')} → ${result.results[0]?.scheduledFor}`)
      } else {
        logger.error(`Single approve failed: ${String(itemId).replace(/[\r\n]/g, '')}: ${result.results[0]?.error}`)
      }
    }).catch(() => {})
  })

  // POST /api/posts/bulk-approve — fire-and-forget: returns 202 immediately, processes sequentially in queue
  // Body: { itemIds: string[], priority?: boolean }
  router.post('/api/posts/bulk-approve', (req, res) => {
    const { itemIds, priority } = req.body
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds must be a non-empty array' })
    }

    res.status(202).json({ accepted: true, count: itemIds.length })

    enqueueApproval(itemIds, { priority: priority === true }).catch(err => {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`Bulk approve background failed: ${String(msg).replace(/[\r\n]/g, '')}`)
    })
  })

  // POST /api/posts/:id/reject — mark as rejected in Azure
  router.post('/api/posts/:id/reject', async (req, res) => {
    try {
      // Look up the item to get the videoSlug
      const allItems = await getContentItems()
      const match = allItems.find(r => r.rowKey === req.params.id)
      if (!match) return res.status(404).json({ error: 'Item not found' })

      await azureRejectItem(match.partitionKey, match.rowKey)
      res.json({ success: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: msg })
    }
  })

  // POST /api/posts/bulk-reject — fire-and-forget: returns 202 immediately, rejects in background
  router.post('/api/posts/bulk-reject', (req, res) => {
    const { itemIds } = req.body
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds must be a non-empty array' })
    }

    res.status(202).json({ accepted: true, count: itemIds.length })

    ;(async () => {
      const allItems = await getContentItems()
      const itemLookup = new Map(allItems.map(r => [r.rowKey, r.partitionKey]))
      let succeeded = 0
      for (const itemId of itemIds) {
        try {
          const videoSlug = itemLookup.get(itemId)
          if (!videoSlug) {
            logger.error(`Bulk reject: item not found: ${String(itemId).replace(/[\r\n]/g, '')}`)
            continue
          }
          await azureRejectItem(videoSlug, itemId)
          succeeded++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logger.error(`Bulk reject failed for ${String(itemId).replace(/[\r\n]/g, '')}: ${String(msg).replace(/[\r\n]/g, '')}`)
        }
      }
      logger.info(`Bulk reject completed: ${succeeded} of ${itemIds.length} rejected`)
    })()
  })

  // PUT /api/posts/:id — edit post content
  router.put('/api/posts/:id', async (req, res) => {
    try {
      const { postContent } = req.body

      // Look up the item to get the videoSlug
      const allItems = await getContentItems()
      const match = allItems.find(r => r.rowKey === req.params.id)
      if (!match) return res.status(404).json({ error: 'Item not found' })

      const updated = await azureUpdateItem(match.partitionKey, match.rowKey, { postContent })
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

      // Try queue preview first (Late API queue-based scheduling)
      const queueId = await getQueueId(normalized, clipType ?? 'short')
      if (queueId) {
        try {
          const profileId = await getProfileId()
          const client = createLateApiClient()
          const preview = await client.previewQueue(profileId, queueId, 1)
          if (preview.slots?.length > 0) {
            return res.json({ platform: normalized, nextSlot: preview.slots[0], source: 'queue' })
          }
        } catch {
          // Fall through to local calculation
        }
      }

      // Fallback to local slot calculation
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
