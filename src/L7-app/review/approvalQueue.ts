import { join } from '../../L1-infra/paths/paths.js'
import { ensureDirectory, removeDirectory } from '../../L1-infra/fileSystem/fileSystem.js'
import { getConfig } from '../../L1-infra/config/environment.js'
import {
  getItemById,
  approveItem as azureApproveItem,
  markPublished,
  downloadMediaToFile,
  type ReviewItem,
} from '../../L3-services/azureStorage/azureReviewDataSource.js'
import { getContentItems } from '../../L3-services/azureStorage/azureStorageService.js'
import { getIdeasByIds } from '../../L3-services/ideation/ideaService.js'
import { findNextSlot } from '../../L3-services/scheduler/scheduler.js'
import { loadScheduleConfig } from '../../L3-services/scheduler/scheduleConfig.js'
import { getAccountId } from '../../L3-services/socialPosting/accountMapping.js'
import { createLateApiClient } from '../../L3-services/lateApi/lateApiService.js'
import { getQueueId, getProfileId } from '../../L3-services/queueMapping/queueMapping.js'
import { fromLatePlatform, normalizePlatformString } from '../../L0-pure/types/index.js'
import logger from '../../L1-infra/logger/configLogger.js'

// ── Types ────────────────────────────────────────────────────────────────

interface ApprovalJob {
  itemIds: string[]
  priority: boolean
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

export function enqueueApproval(itemIds: string[], options?: { priority?: boolean }): Promise<ApprovalResult> {
  return new Promise(resolve => {
    queue.push({ itemIds, priority: options?.priority ?? false, resolve })
    if (!processing) drain()
  })
}

async function drain(): Promise<void> {
  processing = true
  while (queue.length > 0) {
    const job = queue.shift()!
    try {
      const result = await processApprovalBatch(job.itemIds, job.priority)
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

async function processApprovalBatch(itemIds: string[], priority: boolean): Promise<ApprovalResult> {
  const client = createLateApiClient()
  const schedConfig = await loadScheduleConfig()
  const results: ApprovalResult['results'] = []
  const rateLimitedPlatforms = new Set<string>()

  interface EnrichedItem {
    id: string
    videoSlug: string
    publishBy: string | null
    hasIdeas: boolean
    createdAt: string | null
  }

  // Load all pending content items from Azure Table and filter to requested IDs
  const allPending = await getContentItems({ status: 'pending_review' })
  const itemMap = new Map<string, { record: (typeof allPending)[number]; videoSlug: string }>()
  for (const record of allPending) {
    if (itemIds.includes(record.rowKey)) {
      itemMap.set(record.rowKey, { record, videoSlug: record.partitionKey })
    }
  }

  // Also try loading items individually for any IDs not found in pending query
  const missingIds = itemIds.filter(id => !itemMap.has(id))
  if (missingIds.length > 0) {
    const allItems = await getContentItems()
    const missingIdSet = new Set(missingIds)
    for (const record of allItems) {
      if (missingIdSet.has(record.rowKey)) {
        itemMap.set(record.rowKey, { record, videoSlug: record.partitionKey })
      }
    }
  }

  const allIdeaIds = new Set<string>()
  for (const { record } of itemMap.values()) {
    const ideas = record.ideaIds ? record.ideaIds.split(',').filter(Boolean) : []
    for (const ideaId of ideas) {
      allIdeaIds.add(ideaId)
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

  const enriched: EnrichedItem[] = itemIds.map((id) => {
    const entry = itemMap.get(id)
    if (!entry) return { id, videoSlug: '', publishBy: null, hasIdeas: false, createdAt: null }

    const { record, videoSlug } = entry
    const createdAt = record.createdAt || null
    const ideas = record.ideaIds ? record.ideaIds.split(',').filter(Boolean) : []

    if (ideas.length === 0) {
      return { id, videoSlug, publishBy: null, hasIdeas: false, createdAt }
    }

    const dates = ideas
      .map((ideaId) => ideaMap.get(ideaId)?.publishBy)
      .filter((publishBy): publishBy is string => Boolean(publishBy))
      .sort()
    return { id, videoSlug, publishBy: dates[0] ?? null, hasIdeas: true, createdAt }
  })

  enriched.sort((a, b) => {
    if (a.hasIdeas && !b.hasIdeas) return -1
    if (!a.hasIdeas && b.hasIdeas) return 1

    if (a.hasIdeas && b.hasIdeas) {
      const aTime = a.publishBy ? new Date(a.publishBy).getTime() : Infinity
      const bTime = b.publishBy ? new Date(b.publishBy).getTime() : Infinity
      if (aTime !== bTime) return aTime - bTime

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
  const videoSlugMap = new Map(enriched.map((entry) => [entry.id, entry.videoSlug]))

  // Create a temp directory for downloading media blobs
  const config = getConfig()
  const tempDir = join(config.OUTPUT_DIR, '.azure-media-temp')
  await ensureDirectory(tempDir)

  try {
    for (const itemId of sortedIds) {
      const entry = itemMap.get(itemId)

      try {
        if (!entry) {
          results.push({ itemId, success: false, error: 'Item not found' })
          continue
        }

        const { record, videoSlug } = entry
        const latePlatform = normalizePlatformString(record.platform)

        if (rateLimitedPlatforms.has(latePlatform)) {
          results.push({ itemId, success: false, error: `${latePlatform} rate-limited` })
          continue
        }

        const ideaIds = record.ideaIds ? record.ideaIds.split(',').filter(Boolean) : []
        const publishBy = publishByMap.get(itemId)

        const clipType = record.clipType || 'short'
        const queueId = await getQueueId(latePlatform, clipType)
        let slot: string | undefined
        let useQueue = false

        if (priority && queueId) {
          // Priority mode: shift existing queue posts to free the first slot
          logger.info(`⚡ Priority scheduling for ${latePlatform}/${clipType}`)
          const { priorityShiftQueue } = await import('../../L3-services/lateApi/lateApiService.js')
          const shiftResult = await priorityShiftQueue(latePlatform, clipType)
          if (shiftResult) {
            slot = shiftResult.freedSlot
            useQueue = false // Use scheduledFor with the freed slot, not queue append
            logger.info(`⚡ Freed slot: ${slot} (shifted ${shiftResult.shiftedCount} posts)`)
          } else {
            // Fallback: no posts to shift, just use queue normally
            useQueue = true
            logger.info(`⚡ No posts to shift — using queue normally`)
          }
        } else if (queueId) {
          useQueue = true
          logger.debug(`Using Late queue ${queueId} for ${latePlatform}/${clipType} (idea priority via batch order)`)
        } else {
          logger.debug(`No queue for ${latePlatform}/${clipType}, using local slot calculation`)
          const foundSlot = ideaIds.length > 0
            ? await findNextSlot(latePlatform, clipType, { ideaIds, publishBy })
            : await findNextSlot(latePlatform, clipType)
          slot = foundSlot ?? undefined
          if (!slot) {
            results.push({ itemId, success: false, error: `No available slot for ${latePlatform}` })
            continue
          }
        }

        const platform = fromLatePlatform(latePlatform)
        const accountId = await getAccountId(platform)
        if (!accountId) {
          results.push({ itemId, success: false, error: `No account for ${latePlatform}` })
          continue
        }

        let mediaItems: Array<{ type: 'image' | 'video'; url: string; thumbnail?: string }> | undefined
        let platformSpecificData: Record<string, unknown> | undefined

        // Download media from Azure blob and upload to Late
        if (record.mediaFilename) {
          try {
            const localMediaPath = join(tempDir, `${itemId}-${record.mediaFilename}`)
            await downloadMediaToFile(itemId, record.mediaFilename, localMediaPath)

            const upload = await client.uploadMedia(localMediaPath)
            const mediaItem: { type: 'image' | 'video'; url: string; thumbnail?: string } = { type: upload.type, url: upload.url }

            // Upload thumbnail if available
            if (record.thumbnailFilename) {
              try {
                const localThumbPath = join(tempDir, `${itemId}-${record.thumbnailFilename}`)
                await downloadMediaToFile(itemId, record.thumbnailFilename, localThumbPath)

                const thumbUpload = await client.uploadMedia(localThumbPath)
                const thumbUrl = thumbUpload.url

                mediaItem.thumbnail = thumbUrl

                if (latePlatform === 'instagram') {
                  platformSpecificData = { ...platformSpecificData, instagramThumbnail: thumbUrl }
                }

                logger.info(`Uploaded thumbnail for ${String(itemId).replace(/[\r\n]/g, '')}`)
              } catch (thumbErr) {
                logger.warn(`Failed to upload thumbnail for ${String(itemId).replace(/[\r\n]/g, '')}: ${thumbErr instanceof Error ? thumbErr.message : String(thumbErr)}`)
              }
            }

            mediaItems = [mediaItem]
          } catch (mediaErr) {
            logger.warn(`Failed to download/upload media for ${String(itemId).replace(/[\r\n]/g, '')}: ${mediaErr instanceof Error ? mediaErr.message : String(mediaErr)}`)
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

        const profileId = useQueue ? await getProfileId() : undefined
        const createParams: Parameters<typeof client.createPost>[0] = {
          content: record.postContent,
          platforms: [{ platform: latePlatform, accountId }],
          timezone: schedConfig.timezone,
          isDraft: false,
          mediaItems,
          platformSpecificData,
          tiktokSettings,
        }
        if (useQueue) {
          createParams.queuedFromProfile = profileId
          createParams.queueId = queueId ?? undefined
        } else {
          createParams.scheduledFor = slot
        }
        const latePost = await client.createPost(createParams)

        // Mark as approved, then published with Late API data
        await azureApproveItem(videoSlug, itemId)
        await markPublished(videoSlug, itemId, {
          latePostId: latePost._id,
          scheduledFor: latePost.scheduledFor ?? slot ?? '',
          publishedUrl: undefined,
        })

        results.push({ itemId, success: true, scheduledFor: latePost.scheduledFor ?? slot, latePostId: latePost._id })
      } catch (itemErr) {
        const itemMsg = itemErr instanceof Error ? itemErr.message : String(itemErr)
        if (itemMsg.includes('429') || itemMsg.includes('Daily post limit')) {
          const entry2 = itemMap.get(itemId)
          const latePlatform = normalizePlatformString(entry2?.record.platform ?? '')
          rateLimitedPlatforms.add(latePlatform)
          logger.warn(`Approval queue: ${latePlatform} hit daily post limit, skipping remaining ${latePlatform} items`)
          results.push({ itemId, success: false, error: `${latePlatform} rate-limited` })
        } else {
          logger.error(`Approval queue: failed for ${String(itemId).replace(/[\r\n]/g, '')}: ${String(itemMsg).replace(/[\r\n]/g, '')}`)
          results.push({ itemId, success: false, error: itemMsg })
        }
      }
    }
  } finally {
    // Clean up temp directory
    try {
      await removeDirectory(tempDir)
    } catch {
      // Ignore cleanup errors
    }
  }

  const scheduled = results.filter(r => r.success).length
  const failed = itemIds.length - scheduled
  if (scheduled > 0) {
    logger.info(`Approval queue: ${scheduled} of ${itemIds.length} scheduled${rateLimitedPlatforms.size > 0 ? ` (rate-limited: ${[...rateLimitedPlatforms].join(', ')})` : ''}`)
  }

  return { scheduled, failed, results, rateLimitedPlatforms: [...rateLimitedPlatforms] }
}
