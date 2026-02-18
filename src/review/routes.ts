import { fileExists } from '../core/fileSystem.js'
import { Router } from '../core/http.js'
import { getPendingItems, getGroupedPendingItems, getItem, updateItem, approveItem, rejectItem, approveBulk, type BulkApprovalResult } from '../services/postStore.js'
import { findNextSlot, getScheduleCalendar } from '../services/scheduler'
import { getAccountId } from '../services/accountMapping'
import { LateApiClient, type LateAccount, type LateProfile } from '../services/lateApi'
import { loadScheduleConfig } from '../services/scheduleConfig'
import { fromLatePlatform, normalizePlatformString } from '../types'
import logger from '../config/logger'

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
        const client = new LateApiClient()
        const accounts = await client.listAccounts()
        setCache('accounts', accounts)
        return accounts
      })(),
      (async () => {
        const cached = getCached<LateProfile | null>('profile')
        if (cached !== undefined) return cached
        const client = new LateApiClient()
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

  // POST /api/posts/:id/approve — smart-schedule + upload media + publish to Late
  router.post('/api/posts/:id/approve', async (req, res) => {
    try {
      const item = await getItem(req.params.id)
      if (!item) return res.status(404).json({ error: 'Item not found' })

      // Normalize platform — LLM may output "x (twitter)" but Late API and schedule use "twitter"
      const latePlatform = normalizePlatformString(item.metadata.platform)

      // 1. Find next available slot
      const slot = await findNextSlot(latePlatform, item.metadata.clipType)
      if (!slot) return res.status(409).json({ error: 'No available schedule slots in the current scheduling window' })

      // 2. Resolve account ID
      const platform = fromLatePlatform(latePlatform)
      const accountId = item.metadata.accountId || await getAccountId(platform)
      if (!accountId) return res.status(400).json({ error: `No Late account connected for ${latePlatform}` })

      // 3. Upload media if exists (fallback to source media when queue copy is missing)
      const client = new LateApiClient()
      let mediaItems: Array<{ type: 'image' | 'video'; url: string }> | undefined
      const effectiveMediaPath = item.mediaPath ?? item.metadata.sourceMediaPath
      if (effectiveMediaPath) {
        const mediaExists = await fileExists(effectiveMediaPath)
        if (mediaExists) {
          if (!item.mediaPath && item.metadata.sourceMediaPath) {
            logger.info(`Using source media fallback for ${String(item.id).replace(/[\r\n]/g, '')}: ${String(item.metadata.sourceMediaPath).replace(/[\r\n]/g, '')}`)
          }
          const upload = await client.uploadMedia(effectiveMediaPath)
          mediaItems = [{ type: upload.type, url: upload.url }]
        }
      }

      // 4. Create scheduled post in Late
      const isTikTok = latePlatform === 'tiktok'
      const tiktokSettings = isTikTok ? {
        privacy_level: 'PUBLIC_TO_EVERYONE',
        allow_comment: true,
        allow_duet: true,
        allow_stitch: true,
        content_preview_confirmed: true,
        express_consent_given: true,
      } : undefined

      const schedConfig = await loadScheduleConfig()
      const latePost = await client.createPost({
        content: item.postContent,
        platforms: [{ platform: latePlatform, accountId }],
        scheduledFor: slot,
        timezone: schedConfig.timezone,
        mediaItems,
        platformSpecificData: item.metadata.platformSpecificData,
        tiktokSettings,
      })

      // 5. Move to published (persist resolved accountId to metadata)
      await approveItem(req.params.id, {
        latePostId: latePost._id,
        scheduledFor: slot,
        publishedUrl: undefined,
        accountId,
      })

      res.json({ success: true, scheduledFor: slot, latePostId: latePost._id })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`Approve failed for ${String(req.params.id).replace(/[\r\n]/g, '')}: ${String(msg).replace(/[\r\n]/g, '')}`)
      res.status(500).json({ error: msg })
    }
  })

  // POST /api/posts/bulk-approve — fire-and-forget: returns 202 immediately, processes in background
  router.post('/api/posts/bulk-approve', (req, res) => {
    const { itemIds } = req.body
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds must be a non-empty array' })
    }

    res.status(202).json({ accepted: true, count: itemIds.length })

    // Process in background — errors are logged, not sent to client
    ;(async () => {
      try {
        const client = new LateApiClient()
        const schedConfig = await loadScheduleConfig()
        const publishDataMap = new Map<string, { latePostId: string; scheduledFor: string; publishedUrl?: string; accountId?: string }>()

        const rateLimitedPlatforms = new Set<string>()

        for (const itemId of itemIds) {
          try {
            const item = await getItem(itemId)
            if (!item) {
              logger.warn(`Bulk approve: item ${String(itemId).replace(/[\r\n]/g, '')} not found`)
              continue
            }

            const latePlatform = normalizePlatformString(item.metadata.platform)

            // Skip platforms that already hit their daily limit
            if (rateLimitedPlatforms.has(latePlatform)) {
              logger.warn(`Bulk approve: skipping ${String(itemId).replace(/[\r\n]/g, '')} — ${latePlatform} is rate-limited`)
              continue
            }

            const slot = await findNextSlot(latePlatform, item.metadata.clipType)
            if (!slot) {
              logger.warn(`Bulk approve: no slot available for ${latePlatform}`)
              continue
            }

            const platform = fromLatePlatform(latePlatform)
            const accountId = item.metadata.accountId || await getAccountId(platform)
            if (!accountId) {
              logger.warn(`Bulk approve: no account connected for ${latePlatform}`)
              continue
            }

            let mediaItems: Array<{ type: 'image' | 'video'; url: string }> | undefined
            const effectiveMediaPath = item.mediaPath ?? item.metadata.sourceMediaPath
            if (effectiveMediaPath) {
              const mediaExists = await fileExists(effectiveMediaPath)
              if (mediaExists) {
                const upload = await client.uploadMedia(effectiveMediaPath)
                mediaItems = [{ type: upload.type, url: upload.url }]
              }
            }

            const isTikTok = latePlatform === 'tiktok'
            const tiktokSettings = isTikTok ? {
              privacy_level: 'PUBLIC_TO_EVERYONE',
              allow_comment: true,
              allow_duet: true,
              allow_stitch: true,
              content_preview_confirmed: true,
              express_consent_given: true,
            } : undefined

            const latePost = await client.createPost({
              content: item.postContent,
              platforms: [{ platform: latePlatform, accountId }],
              scheduledFor: slot,
              timezone: schedConfig.timezone,
              mediaItems,
              platformSpecificData: item.metadata.platformSpecificData,
              tiktokSettings,
            })

            publishDataMap.set(itemId, {
              latePostId: latePost._id,
              scheduledFor: slot,
              publishedUrl: undefined,
              accountId,
            })
          } catch (itemErr) {
            const itemMsg = itemErr instanceof Error ? itemErr.message : String(itemErr)
            const latePlatform = normalizePlatformString((await getItem(itemId))?.metadata.platform ?? '')
            if (itemMsg.includes('429') || itemMsg.includes('Daily post limit')) {
              rateLimitedPlatforms.add(latePlatform)
              logger.warn(`Bulk approve: ${latePlatform} hit daily post limit, skipping remaining ${latePlatform} items`)
            } else {
              logger.error(`Bulk approve: failed for ${String(itemId).replace(/[\r\n]/g, '')}: ${String(itemMsg).replace(/[\r\n]/g, '')}`)
            }
          }
        }

        // Approve all items that were successfully posted (even if some failed)
        const successIds = itemIds.filter(id => publishDataMap.has(id))
        if (successIds.length > 0) {
          const results = await approveBulk(successIds, publishDataMap)
          logger.info(`Bulk approve completed: ${results.length} of ${itemIds.length} scheduled (${rateLimitedPlatforms.size > 0 ? `rate-limited: ${[...rateLimitedPlatforms].join(', ')}` : 'no rate limits hit'})`)
        } else {
          logger.warn(`Bulk approve: 0 of ${itemIds.length} items scheduled (${rateLimitedPlatforms.size > 0 ? `rate-limited: ${[...rateLimitedPlatforms].join(', ')}` : 'all failed'})`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error(`Bulk approve background failed: ${String(msg).replace(/[\r\n]/g, '')}`)
      }
    })()
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

      const client = new LateApiClient()
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

      const client = new LateApiClient()
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
