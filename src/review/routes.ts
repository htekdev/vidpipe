import { Router } from 'express'
import { getPendingItems, getItem, updateItem, approveItem, rejectItem } from '../services/postStore'
import { findNextSlot, getScheduleCalendar } from '../services/scheduler'
import { getAccountId } from '../services/accountMapping'
import { LateApiClient } from '../services/lateApi'
import { loadScheduleConfig } from '../services/scheduleConfig'
import { fromLatePlatform } from '../types'
import logger from '../config/logger'

export function createRouter(): Router {
  const router = Router()

  // GET /api/posts/pending — list all pending review items
  router.get('/api/posts/pending', async (req, res) => {
    const items = await getPendingItems()
    res.json({ items, total: items.length })
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

      // 1. Find next available slot
      const slot = await findNextSlot(item.metadata.platform)
      if (!slot) return res.status(409).json({ error: 'No available schedule slots within 14 days' })

      // 2. Resolve account ID
      const platform = fromLatePlatform(item.metadata.platform)
      const accountId = item.metadata.accountId || await getAccountId(platform)
      if (!accountId) return res.status(400).json({ error: `No Late account connected for ${item.metadata.platform}` })

      // 3. Upload media if exists
      const client = new LateApiClient()
      let mediaUrls: string[] | undefined
      if (item.hasMedia && item.mediaPath) {
        const upload = await client.uploadMedia(item.mediaPath)
        mediaUrls = [upload.url]
      }

      // 4. Create scheduled post in Late
      const schedConfig = await loadScheduleConfig()
      const latePost = await client.createPost({
        content: item.postContent,
        platforms: [{ platform: item.metadata.platform, accountId }],
        scheduledFor: slot,
        timezone: schedConfig.timezone,
        mediaUrls,
        platformSpecificData: item.metadata.platformSpecificData,
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
      logger.error(`Approve failed for ${req.params.id}: ${msg}`)
      res.status(500).json({ error: msg })
    }
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
      const slot = await findNextSlot(req.params.platform)
      res.json({ platform: req.params.platform, nextSlot: slot })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: msg })
    }
  })

  return router
}
