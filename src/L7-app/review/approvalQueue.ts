import { fileExists } from '../../L1-infra/fileSystem/fileSystem.js'
import { getItem, approveItem, approveBulk } from '../../L3-services/postStore/postStore.js'
import { getIdeasByIds } from '../../L3-services/ideation/ideaService.js'
import { findNextSlot } from '../../L3-services/scheduler/scheduler.js'
import { loadScheduleConfig } from '../../L3-services/scheduler/scheduleConfig.js'
import { getAccountId } from '../../L3-services/socialPosting/accountMapping.js'
import { createLateApiClient } from '../../L3-services/lateApi/lateApiService.js'
import { fromLatePlatform, normalizePlatformString } from '../../L0-pure/types/index.js'
import logger from '../../L1-infra/logger/configLogger.js'

// ── Types ────────────────────────────────────────────────────────────────

interface ApprovalJob {
  itemIds: string[]
  resolve: (result: ApprovalResult) => void
}

export interface ApprovalResult {
  scheduled: number
  failed: number
  results: Array<{
    itemId: string
    success: boolean
    scheduledFor?: string
    latePostId?: string
    error?: string
  }>
  rateLimitedPlatforms: string[]
}

// ── Sequential approval queue ────────────────────────────────────────────
// All approve operations (single + bulk) funnel through this queue.
// Items are processed one at a time, preventing findNextSlot() race conditions.

const queue: ApprovalJob[] = []
let processing = false

export function enqueueApproval(itemIds: string[]): Promise<ApprovalResult> {
  return new Promise(resolve => {
    queue.push({ itemIds, resolve })
    if (!processing) drain()
  })
}

async function drain(): Promise<void> {
  processing = true
  while (queue.length > 0) {
    const job = queue.shift()!
    try {
      const result = await processApprovalBatch(job.itemIds)
      job.resolve(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`Approval queue drain error: ${msg.replace(/[\r\n]/g, '')}`)
      job.resolve({
        scheduled: 0,
        failed: job.itemIds.length,
        results: job.itemIds.map(id => ({ itemId: id, success: false, error: msg })),
        rateLimitedPlatforms: [],
      })
    }
  }
  processing = false
}

async function processApprovalBatch(itemIds: string[]): Promise<ApprovalResult> {
  const client = createLateApiClient()
  const schedConfig = await loadScheduleConfig()
  const publishDataMap = new Map<string, { latePostId: string; scheduledFor: string; publishedUrl?: string; accountId?: string }>()
  const results: ApprovalResult['results'] = []
  const rateLimitedPlatforms = new Set<string>()

  interface EnrichedItem {
    id: string
    publishBy: string | null
    hasIdeas: boolean
    createdAt: string | null
  }

  const loadedItems = await Promise.all(
    itemIds.map(async (id) => ({ id, item: await getItem(id) })),
  )
  const itemMap = new Map(loadedItems.map(({ id, item }) => [id, item]))

  const allIdeaIds = new Set<string>()
  for (const { item } of loadedItems) {
    if (item?.metadata.ideaIds?.length) {
      for (const ideaId of item.metadata.ideaIds) {
        allIdeaIds.add(ideaId)
      }
    }
  }

  let ideaMap = new Map<string, { publishBy?: string }>()
  if (allIdeaIds.size > 0) {
    try {
      const allIdeas = await getIdeasByIds([...allIdeaIds])
      for (const idea of allIdeas) {
        ideaMap.set(idea.id, idea)
        ideaMap.set(String(idea.issueNumber), idea)
      }
    } catch {
      // Fall through — enriched items will have no publishBy
    }
  }

  const enriched: EnrichedItem[] = loadedItems.map(({ id, item }) => {
    const createdAt = item?.metadata.createdAt ?? null
    if (!item?.metadata.ideaIds?.length) {
      return { id, publishBy: null, hasIdeas: false, createdAt }
    }

    const dates = item.metadata.ideaIds
      .map((ideaId) => ideaMap.get(ideaId)?.publishBy)
      .filter((publishBy): publishBy is string => Boolean(publishBy))
      .sort()
    return { id, publishBy: dates[0] ?? null, hasIdeas: true, createdAt }
  })

  enriched.sort((a, b) => {
    // Tier 1: idea-linked items before non-idea items
    if (a.hasIdeas && !b.hasIdeas) return -1
    if (!a.hasIdeas && b.hasIdeas) return 1

    // Tier 2: within idea items, soonest publishBy first
    if (a.hasIdeas && b.hasIdeas) {
      const aTime = a.publishBy ? new Date(a.publishBy).getTime() : Infinity
      const bTime = b.publishBy ? new Date(b.publishBy).getTime() : Infinity
      if (aTime !== bTime) return aTime - bTime

      // Tier 3: same publishBy — earliest createdAt wins
      if (a.createdAt && b.createdAt) {
        const aCreated = new Date(a.createdAt).getTime()
        const bCreated = new Date(b.createdAt).getTime()
        if (aCreated !== bCreated) return aCreated - bCreated
      }
    }

    return 0
  })

  const sortedIds = enriched.map((entry) => entry.id)
  const publishByMap = new Map(
    enriched.flatMap((entry) => (entry.publishBy ? [[entry.id, entry.publishBy] as const] : [])),
  )

  for (const itemId of sortedIds) {
    const item = itemMap.get(itemId) ?? null

    try {
      if (!item) {
        results.push({ itemId, success: false, error: 'Item not found' })
        continue
      }

      const latePlatform = normalizePlatformString(item.metadata.platform)

      if (rateLimitedPlatforms.has(latePlatform)) {
        results.push({ itemId, success: false, error: `${latePlatform} rate-limited` })
        continue
      }

      const ideaIds = item.metadata.ideaIds
      const publishBy = publishByMap.get(itemId)
      const slot = ideaIds?.length
        ? await findNextSlot(latePlatform, item.metadata.clipType, { ideaIds, publishBy })
        : await findNextSlot(latePlatform, item.metadata.clipType)
      if (!slot) {
        results.push({ itemId, success: false, error: `No available slot for ${latePlatform}` })
        continue
      }

      const platform = fromLatePlatform(latePlatform)
      const accountId = item.metadata.accountId || await getAccountId(platform)
      if (!accountId) {
        results.push({ itemId, success: false, error: `No account for ${latePlatform}` })
        continue
      }

      let mediaItems: Array<{ type: 'image' | 'video'; url: string; thumbnail?: string }> | undefined
      let platformSpecificData: Record<string, unknown> | undefined = item.metadata.platformSpecificData
      const effectiveMediaPath = item.mediaPath ?? item.metadata.sourceMediaPath
      if (effectiveMediaPath) {
        const mediaExists = await fileExists(effectiveMediaPath)
        if (mediaExists) {
          if (!item.mediaPath && item.metadata.sourceMediaPath) {
            logger.info(`Using source media fallback for ${String(item.id).replace(/[\r\n]/g, '')}: ${String(item.metadata.sourceMediaPath).replace(/[\r\n]/g, '')}`)
          }
          const upload = await client.uploadMedia(effectiveMediaPath)
          const mediaItem: { type: 'image' | 'video'; url: string; thumbnail?: string } = { type: upload.type, url: upload.url }

          // Upload thumbnail if available and attach to media item
          const effectiveThumbnailPath = item.thumbnailPath ?? item.metadata.thumbnailPath
          if (effectiveThumbnailPath && await fileExists(effectiveThumbnailPath)) {
            try {
              const thumbUpload = await client.uploadMedia(effectiveThumbnailPath)
              const thumbUrl = thumbUpload.url

              // YouTube: thumbnail field on mediaItems
              mediaItem.thumbnail = thumbUrl

              // Instagram: instagramThumbnail in platformSpecificData
              if (latePlatform === 'instagram') {
                platformSpecificData = { ...platformSpecificData, instagramThumbnail: thumbUrl }
              }

              logger.info(`Uploaded thumbnail for ${String(item.id).replace(/[\r\n]/g, '')}`)
            } catch (thumbErr) {
              logger.warn(`Failed to upload thumbnail for ${String(item.id).replace(/[\r\n]/g, '')}: ${thumbErr instanceof Error ? thumbErr.message : String(thumbErr)}`)
            }
          }

          mediaItems = [mediaItem]
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
        isDraft: false,
        mediaItems,
        platformSpecificData,
        tiktokSettings,
      })

      publishDataMap.set(itemId, {
        latePostId: latePost._id,
        scheduledFor: slot,
        publishedUrl: undefined,
        accountId,
      })
      results.push({ itemId, success: true, scheduledFor: slot, latePostId: latePost._id })
    } catch (itemErr) {
      const itemMsg = itemErr instanceof Error ? itemErr.message : String(itemErr)
      if (itemMsg.includes('429') || itemMsg.includes('Daily post limit')) {
        const latePlatform = normalizePlatformString(item?.metadata.platform ?? '')
        rateLimitedPlatforms.add(latePlatform)
        logger.warn(`Approval queue: ${latePlatform} hit daily post limit, skipping remaining ${latePlatform} items`)
        results.push({ itemId, success: false, error: `${latePlatform} rate-limited` })
      } else {
        logger.error(`Approval queue: failed for ${String(itemId).replace(/[\r\n]/g, '')}: ${String(itemMsg).replace(/[\r\n]/g, '')}`)
        results.push({ itemId, success: false, error: itemMsg })
      }
    }
  }

  // Approve all successfully posted items
  const successIds = itemIds.filter(id => publishDataMap.has(id))
  if (successIds.length === 1) {
    const id = successIds[0]
    await approveItem(id, publishDataMap.get(id)!)
  } else if (successIds.length > 1) {
    await approveBulk(successIds, publishDataMap)
  }

  const scheduled = successIds.length
  const failed = itemIds.length - scheduled
  if (scheduled > 0) {
    logger.info(`Approval queue: ${scheduled} of ${itemIds.length} scheduled${rateLimitedPlatforms.size > 0 ? ` (rate-limited: ${[...rateLimitedPlatforms].join(', ')})` : ''}`)
  }

  return { scheduled, failed, results, rateLimitedPlatforms: [...rateLimitedPlatforms] }
}
