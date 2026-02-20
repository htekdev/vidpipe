import { fileExists } from '../../L1-infra/fileSystem/fileSystem.js'
import { getItem, approveItem, approveBulk } from '../../L3-services/postStore/postStore.js'
import { findNextSlot } from '../../L3-services/scheduler/scheduler.js'
import { loadScheduleConfig } from '../../L3-services/scheduler/scheduleConfig.js'
import { getAccountId } from '../../L3-services/socialPosting/accountMapping.js'
import { LateApiClient } from '../../L3-services/lateApi/lateApiService.js'
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
  const client = new LateApiClient()
  const schedConfig = await loadScheduleConfig()
  const publishDataMap = new Map<string, { latePostId: string; scheduledFor: string; publishedUrl?: string; accountId?: string }>()
  const results: ApprovalResult['results'] = []
  const rateLimitedPlatforms = new Set<string>()

  for (const itemId of itemIds) {
    try {
      const item = await getItem(itemId)
      if (!item) {
        results.push({ itemId, success: false, error: 'Item not found' })
        continue
      }

      const latePlatform = normalizePlatformString(item.metadata.platform)

      if (rateLimitedPlatforms.has(latePlatform)) {
        results.push({ itemId, success: false, error: `${latePlatform} rate-limited` })
        continue
      }

      const slot = await findNextSlot(latePlatform, item.metadata.clipType)
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
        platformSpecificData: item.metadata.platformSpecificData,
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
        const latePlatform = normalizePlatformString((await getItem(itemId))?.metadata.platform ?? '')
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
