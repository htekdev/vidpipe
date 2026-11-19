import { Router } from '../../L1-infra/http/http.js'
import {
  listPendingItems,
  getGroupedItems,
  getItemById,
  updateItem,
  rejectItem,
  approveItem,
  getMediaStream,
  type ReviewItem,
  type ReviewGroup,
} from '../../L3-services/storage/reviewDataSource.js'
import { getContentItems, findContentItemByRowKey } from '../../L3-services/storage/storageService.js'
import { getIdeasByIds } from '../../L3-services/ideation/ideaService.js'
import { findNextSlot, getScheduleCalendar } from '../../L3-services/scheduler/scheduler.js'
import { createLateApiClient, type LateApiClient, type LateAccount, type LateProfile } from '../../L3-services/lateApi/lateApiService.js'
import { normalizePlatformString } from '../../L0-pure/types/index.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { getQueueId, getProfileId } from '../../L3-services/queueMapping/queueMapping.js'
import { enqueueApproval } from './approvalQueue.js'
import { getConfig } from '../../L1-infra/config/environment.js'
import { selectLateProfile } from '../../L3-services/socialPosting/profileSelection.js'

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

async function loadReviewProfile(scope: string): Promise<LateProfile | null> {
  const key = `profile:${scope}`
  const cached = getCached<LateProfile | null>(key)
  if (cached !== undefined) return cached
  const profiles = await createLateApiClient().listProfiles()
  const profile = selectLateProfile(profiles, scope)
  setCache(key, profile)
  return profile
}

async function loadReviewAccounts(scope: string): Promise<LateAccount[]> {
  const key = `accounts:${scope}`
  const cached = getCached<LateAccount[]>(key)
  if (cached) return cached
  const profile = await loadReviewProfile(scope)
  if (!profile) return []
  const accounts = (await createLateApiClient().listAccounts()).filter(account =>
    (typeof account.profileId === 'string' ? account.profileId : account.profileId?._id) === profile._id,
  )
  setCache(key, accounts)
  return accounts
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

function enrichGroupedItems(groups: ReviewGroup[]): ReviewGroupedItem[] {
  // No idea enrichment on listing — publishBy is fetched on-demand per item
  return groups.map((group) => {
    const firstItem = group.items[0]
    const hasMedia = group.items.some(item => Boolean(item.mediaFilename))
    return {
      ...group,
      groupKey: group.videoSlug,
      hasMedia,
      mediaType: firstItem?.mediaType || 'video',
      items: group.items.map(item => ({ ...item })),
    }
  })
}

async function findRequestedItem(itemId: string, videoSlug: unknown): Promise<{ partitionKey: string; rowKey: string } | null> {
  if (typeof videoSlug === 'string' && videoSlug) {
    const item = await getItemById(videoSlug, itemId)
    return item ? { partitionKey: item.videoSlug, rowKey: item.id } : null
  }
  return findContentItemByRowKey(itemId)
}

export function createRouter(): Router {
  const router = Router()

  // GET /api/media/:itemId/:filename — proxy media from selected cloud storage
  router.get('/api/media/:itemId/:filename', async (req, res) => {
    try {
      const { itemId, filename } = req.params
      const videoSlug = typeof req.query.videoSlug === 'string' ? req.query.videoSlug : undefined
      const { stream, contentType, contentLength, contentRange, statusCode, acceptRanges } = videoSlug
        ? await getMediaStream(itemId, filename, req.headers.range, videoSlug)
        : await getMediaStream(itemId, filename, req.headers.range)
      if (res.destroyed) {
        stream.destroy()
        return
      }
      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'private, max-age=3600')
      if (contentLength !== undefined) res.setHeader('Content-Length', contentLength)
      if (contentRange) res.setHeader('Content-Range', contentRange)
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges)
      if (statusCode) res.status(statusCode)
      res.on('close', () => stream.destroy())
      stream.on('error', () => {
        if (!res.headersSent) {
          res.removeHeader('Content-Length')
          res.removeHeader('Content-Range')
          res.status(500).type('json').json({ error: 'Stream error' })
        } else {
          res.destroy()
        }
      })
      stream.pipe(res)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!res.headersSent) {
        const status = err instanceof Error && 'statusCode' in err && err.statusCode === 416 ? 416 : 404
        res.status(status).json({ error: msg })
      }
    }
  })

  // GET /api/posts/pending — list all pending review items (no idea enrichment)
  router.get('/api/posts/pending', async (req, res) => {
    const items = await listPendingItems()
    res.json({ items, total: items.length })
  })

  // GET /api/posts/grouped — list pending items grouped by video/clip (no idea enrichment)
  router.get('/api/posts/grouped', async (req, res) => {
    const groups = enrichGroupedItems(await getGroupedItems())
    res.json({ groups, total: groups.length })
  })

  // GET /api/init — combined endpoint for initial page load (1 request instead of 3)
  router.get('/api/init', async (req, res) => {
    const scope = getConfig().LATE_PROFILE_ID || ''
    const [groupsResult, accountsResult, profileResult] = await Promise.allSettled([
      (async () => enrichGroupedItems(await getGroupedItems()))(),
      loadReviewAccounts(scope),
      loadReviewProfile(scope),
    ])

    if (groupsResult.status === 'rejected') {
      const message = groupsResult.reason instanceof Error ? groupsResult.reason.message : 'Storage unavailable'
      logger.error(`Review storage initialization failed: ${String(message).replace(/[\r\n]/g, '')}`)
      return res.status(503).json({ error: `Unable to load review storage: ${message}` })
    }
    const groups = groupsResult.value
    const accounts = accountsResult.status === 'fulfilled' ? accountsResult.value : []
    const profile = profileResult.status === 'fulfilled' ? profileResult.value : null

    res.json({ groups, total: groups.length, accounts, profile })
  })

  // GET /api/posts/:id — get single post with full content
  router.get('/api/posts/:id', async (req, res) => {
    // Look up the item by RowKey (direct query, not full table scan)
    const match = await findRequestedItem(req.params.id, req.query.videoSlug)
    if (!match) return res.status(404).json({ error: 'Item not found' })

    const item = await getItemById(match.partitionKey, match.rowKey)
    if (!item) return res.status(404).json({ error: 'Item not found' })
    res.json(await enrichReviewItem(item))
  })

  // POST /api/posts/:id/approve — mark approved immediately, then enqueue Late API scheduling
  // Query param ?priority=true to shift existing queue posts and schedule first
  router.post('/api/posts/:id/approve', async (req, res) => {
    const itemId = req.params.id
    const priority = req.query.priority === 'true' || req.body?.priority === true

    // Immediately mark as approved so it disappears from pending review
    try {
      const match = await findRequestedItem(itemId, req.query.videoSlug ?? req.body?.videoSlug)
      if (match) {
        await approveItem(match.partitionKey, match.rowKey)
      }
    } catch {
      // Non-fatal — approval queue will also try to update status
    }

    res.status(202).json({ accepted: true })

    const scope = req.query.videoSlug ?? req.body?.videoSlug
    enqueueApproval([itemId], { priority, ...(typeof scope === 'string' && scope ? { videoSlugs: { [itemId]: scope } } : {}) }).then(result => {
      if (result.scheduled > 0) {
        logger.info(`Single approve completed: ${String(itemId).replace(/[\r\n]/g, '')} → ${result.results[0]?.scheduledFor}`)
      } else {
        logger.error(`Single approve failed: ${String(itemId).replace(/[\r\n]/g, '')}: ${result.results[0]?.error}`)
      }
    }).catch(() => {})
  })

  // POST /api/posts/bulk-approve — mark approved immediately, then process Late API scheduling in background
  // Body: { itemIds: string[], priority?: boolean }
  router.post('/api/posts/bulk-approve', async (req, res) => {
    const { itemIds, priority, videoSlugs } = req.body
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds must be a non-empty array' })
    }

    // Immediately mark all items as approved so they disappear from pending review
    for (const itemId of itemIds) {
      try {
        const match = await findRequestedItem(itemId, videoSlugs?.[itemId])
        if (match) {
          await approveItem(match.partitionKey, match.rowKey)
        }
      } catch {
        // Non-fatal — approval queue will also try to update status
      }
    }

    res.status(202).json({ accepted: true, count: itemIds.length })

    enqueueApproval(itemIds, { priority: priority === true, ...(videoSlugs ? { videoSlugs } : {}) }).catch(err => {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`Bulk approve background failed: ${String(msg).replace(/[\r\n]/g, '')}`)
    })
  })

  // POST /api/posts/:id/reject — mark as rejected in selected storage
  router.post('/api/posts/:id/reject', async (req, res) => {
    try {
      const match = await findRequestedItem(req.params.id, req.query.videoSlug ?? req.body?.videoSlug)
      if (!match) return res.status(404).json({ error: 'Item not found' })

      await rejectItem(match.partitionKey, match.rowKey)
      res.json({ success: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: msg })
    }
  })

  // POST /api/posts/bulk-reject — fire-and-forget: returns 202 immediately, rejects in background
  router.post('/api/posts/bulk-reject', (req, res) => {
    const { itemIds, videoSlugs } = req.body
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds must be a non-empty array' })
    }

    res.status(202).json({ accepted: true, count: itemIds.length })

    ;(async () => {
      const allItems = await getContentItems()
      let succeeded = 0
      for (const itemId of itemIds) {
        try {
          const matches = allItems.filter(record => record.rowKey === itemId
            && (!videoSlugs?.[itemId] || record.partitionKey === videoSlugs[itemId]))
          matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.partitionKey.localeCompare(a.partitionKey))
          const videoSlug = matches[0]?.partitionKey
          if (!videoSlug) {
            logger.error(`Bulk reject: item not found: ${String(itemId).replace(/[\r\n]/g, '')}`)
            continue
          }
          await rejectItem(videoSlug, itemId)
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

      const match = await findRequestedItem(req.params.id, req.query.videoSlug ?? req.body?.videoSlug)
      if (!match) return res.status(404).json({ error: 'Item not found' })

      const updated = await updateItem(match.partitionKey, match.rowKey, { postContent })
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
      const accounts = await loadReviewAccounts(getConfig().LATE_PROFILE_ID || '')
      res.json({ accounts })
    } catch (err) {
      res.status(500).json({ accounts: [], error: err instanceof Error ? err.message : 'Failed to fetch accounts' })
    }
  })

  // GET /api/profile — get Late profile info (cached)
  router.get('/api/profile', async (req, res) => {
    try {
      const profile = await loadReviewProfile(getConfig().LATE_PROFILE_ID || '')
      res.json({ profile })
    } catch (err) {
      res.status(500).json({ profile: null, error: err instanceof Error ? err.message : 'Failed to fetch profile' })
    }
  })

  return router
}
