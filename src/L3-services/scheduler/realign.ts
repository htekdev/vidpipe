import { LateApiClient } from '../../L2-clients/late/lateApi.js'
import type { LatePost } from '../../L2-clients/late/lateApi.js'
import {
  loadScheduleConfig,
  getPlatformSchedule,
  getDisplacementConfig,
  type DayOfWeek,
  type PlatformSchedule,
} from './scheduleConfig.js'
import { getPublishedItems } from '../postStore/postStore.js'
import logger from '../../L1-infra/logger/configLogger.js'
import {
  schedulePost,
  buildBookedMap,
  getTimezoneOffset,
  buildSlotDatetime,
  getDayOfWeekInTimezone,
  type ScheduleContext,
  type BookedSlot,
} from './scheduler.js'

// ── Types ──────────────────────────────────────────────────────────────

export interface RealignPost {
  post: LatePost
  platform: string
  clipType: 'short' | 'medium-clip' | 'video'
  oldScheduledFor: string | null
  newScheduledFor: string
}

export interface CancelPost {
  post: LatePost
  platform: string
  clipType: 'short' | 'medium-clip' | 'video'
  reason: string
}

export interface RealignPlan {
  posts: RealignPost[]
  toCancel: CancelPost[]
  skipped: number
  unmatched: number
  totalFetched: number
}

export interface RealignResult {
  updated: number
  cancelled: number
  failed: number
  errors: Array<{ postId: string; error: string }>
}

export interface PriorityRule {
  keywords: string[]
  saturation: number
  from?: string
  to?: string
}

// ── Core ───────────────────────────────────────────────────────────────

/**
 * Late API uses "twitter" but schedule.json uses "x".
 * Normalize so slot lookups succeed.
 */
const PLATFORM_ALIASES: Record<string, string> = { twitter: 'x' }
function normalizeSchedulePlatform(platform: string): string {
  return PLATFORM_ALIASES[platform] ?? platform
}

/**
 * Normalize post content for fuzzy matching: lowercase, collapse whitespace, trim.
 */
function normalizeContent(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)
}

export interface ClipTypeMaps {
  byLatePostId: Map<string, 'short' | 'medium-clip' | 'video'>
  byContent: Map<string, 'short' | 'medium-clip' | 'video'>
}

/**
 * Build maps for correlating Late posts with clip types.
 * Primary: latePostId → clipType
 * Fallback: normalized post content → clipType (for posts without latePostId)
 */
async function buildClipTypeMaps(): Promise<ClipTypeMaps> {
  const published = await getPublishedItems()
  const byLatePostId = new Map<string, 'short' | 'medium-clip' | 'video'>()
  const byContent = new Map<string, 'short' | 'medium-clip' | 'video'>()

  for (const item of published) {
    if (item.metadata.latePostId) {
      byLatePostId.set(item.metadata.latePostId, item.metadata.clipType)
    }
    if (item.postContent) {
      const contentKey = `${item.metadata.platform}::${normalizeContent(item.postContent)}`
      byContent.set(contentKey, item.metadata.clipType)
    }
  }

  logger.debug(`Built clipType maps: ${byLatePostId.size} by latePostId, ${byContent.size} by content`)
  return { byLatePostId, byContent }
}

/**
 * Fetch all posts of given statuses from Late API with pagination.
 */
async function fetchAllPosts(
  client: LateApiClient,
  statuses: readonly string[],
  platform?: string,
): Promise<LatePost[]> {
  const allPosts: LatePost[] = []
  for (const status of statuses) {
    const posts = await client.listPosts({ status, platform })
    allPosts.push(...posts)
    logger.info(`Fetched ${posts.length} ${status} post(s)${platform ? ` for ${platform}` : ''}`)
  }
  return allPosts
}

/**
 * Check if an ISO datetime falls on a valid schedule slot (correct day-of-week and time).
 */
function isOnValidSlot(
  iso: string,
  schedule: PlatformSchedule,
  timezone: string,
): boolean {
  if (schedule.slots.length === 0) return false

  const date = new Date(iso)
  const dayOfWeek = getDayOfWeekInTimezone(date, timezone)
  if (schedule.avoidDays.includes(dayOfWeek)) return false

  // Extract HH:MM in the schedule's timezone
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const timeParts = timeFormatter.formatToParts(date)
  const hour = timeParts.find(p => p.type === 'hour')?.value ?? '00'
  const minute = timeParts.find(p => p.type === 'minute')?.value ?? '00'
  const timeKey = `${hour}:${minute}`

  return schedule.slots.some(slot => slot.time === timeKey && slot.days.includes(dayOfWeek))
}

// ── Build plan ─────────────────────────────────────────────────────────

/**
 * Build a realignment plan: find posts NOT on valid schedule slots and
 * use the scheduler's schedulePost to find new homes for them.
 *
 * schedulePost handles idea priority and recursive displacement automatically.
 *
 * @param options.clipTypeMaps - Injectable maps for testing (otherwise fetched from disk)
 */
export async function buildRealignPlan(options: {
  platform?: string
  clipTypeMaps?: ClipTypeMaps
} = {}): Promise<RealignPlan> {
  const config = await loadScheduleConfig()
  const { timezone } = config
  const client = new LateApiClient()

  const statuses = ['scheduled', 'draft', 'cancelled', 'failed'] as const
  const allPosts = await fetchAllPosts(client, statuses, options.platform)

  if (allPosts.length === 0) {
    return { posts: [], toCancel: [], skipped: 0, unmatched: 0, totalFetched: 0 }
  }

  const { byLatePostId, byContent } = options.clipTypeMaps ?? await buildClipTypeMaps()

  // Tag each post with clipType
  let unmatched = 0
  const tagged: Array<{ post: LatePost; platform: string; clipType: 'short' | 'medium-clip' | 'video' }> = []

  for (const post of allPosts) {
    const platform = post.platforms[0]?.platform
    if (!platform) continue

    let clipType = byLatePostId.get(post._id) ?? null
    if (!clipType && post.content) {
      const contentKey = `${platform}::${normalizeContent(post.content)}`
      clipType = byContent.get(contentKey) ?? null
    }
    if (!clipType) {
      clipType = 'short'
      unmatched++
    }
    tagged.push({ post, platform, clipType })
  }

  // Build shared schedule context
  const bookedMap = await buildBookedMap()
  const ctx: ScheduleContext = {
    timezone,
    bookedMap,
    ideaLinkedPostIds: new Set<string>(),
    lateClient: client,
    displacementEnabled: getDisplacementConfig().enabled,
    dryRun: true,
    depth: 0,
    ideaRefs: [],
    samePlatformMs: 0,
    crossPlatformMs: 0,
    platform: '',
  }

  // Populate idea-linked IDs from the booked map
  for (const [, slot] of bookedMap) {
    if (slot.ideaLinked && slot.postId) {
      ctx.ideaLinkedPostIds.add(slot.postId)
    }
  }

  const result: RealignPost[] = []
  const toCancel: CancelPost[] = []
  let skipped = 0

  // Sort: idea-linked posts first (they get priority slots via displacement)
  tagged.sort((a, b) => {
    const aIdea = ctx.ideaLinkedPostIds.has(a.post._id) ? 0 : 1
    const bIdea = ctx.ideaLinkedPostIds.has(b.post._id) ? 0 : 1
    return aIdea - bIdea
  })

  const nowMs = Date.now()

  for (const { post, platform, clipType } of tagged) {
    const schedulePlatform = normalizeSchedulePlatform(platform)
    const platformConfig = getPlatformSchedule(schedulePlatform, clipType)

    if (!platformConfig || platformConfig.slots.length === 0) {
      if (post.status !== 'cancelled') {
        toCancel.push({ post, platform, clipType, reason: `No schedule slots for ${schedulePlatform}/${clipType}` })
      }
      continue
    }

    // Already on a valid slot — skip
    if (post.scheduledFor && post.status === 'scheduled' && isOnValidSlot(post.scheduledFor, platformConfig, timezone)) {
      skipped++
      continue
    }

    // Free this post's current slot so it can be reassigned
    if (post.scheduledFor) {
      const currentMs = new Date(post.scheduledFor).getTime()
      const currentBooked = bookedMap.get(currentMs)
      if (currentBooked?.postId === post._id) {
        bookedMap.delete(currentMs)
      }
    }

    const isIdea = ctx.ideaLinkedPostIds.has(post._id)
    const label = `${schedulePlatform}/${clipType}:${post._id.slice(-6)}`
    const newSlot = await schedulePost(platformConfig, nowMs, isIdea, label, ctx)

    if (!newSlot) {
      if (post.status !== 'cancelled') {
        toCancel.push({ post, platform, clipType, reason: `No available slot for ${schedulePlatform}/${clipType}` })
      }
      continue
    }

    // Mark the new slot as taken
    const newMs = new Date(newSlot).getTime()
    ctx.bookedMap.set(newMs, {
      scheduledFor: newSlot, source: 'late', postId: post._id,
      platform: schedulePlatform, ideaLinked: isIdea,
    })

    // Check if slot actually changed
    const currentMs = post.scheduledFor ? new Date(post.scheduledFor).getTime() : 0
    if (currentMs === newMs && post.status === 'scheduled') {
      skipped++
      continue
    }

    result.push({
      post,
      platform,
      clipType,
      oldScheduledFor: post.scheduledFor ?? null,
      newScheduledFor: newSlot,
    })
  }

  result.sort((a, b) => new Date(a.newScheduledFor).getTime() - new Date(b.newScheduledFor).getTime())
  return { posts: result, toCancel, skipped, unmatched, totalFetched: allPosts.length }
}

// ── Execute ────────────────────────────────────────────────────────────

/**
 * Execute a realignment plan: update each post via Late API.
 * Optionally reports progress via callback.
 */
export async function executeRealignPlan(
  plan: RealignPlan,
  onProgress?: (completed: number, total: number, phase: 'cancelling' | 'updating') => void,
): Promise<RealignResult> {
  const client = new LateApiClient()
  let updated = 0
  let cancelled = 0
  let failed = 0
  const errors: Array<{ postId: string; error: string }> = []
  const totalOps = plan.toCancel.length + plan.posts.length
  let completed = 0

  // Cancel posts that have no matching schedule
  for (const entry of plan.toCancel) {
    completed++
    try {
      await client.updatePost(entry.post._id, { status: 'cancelled' })
      cancelled++
      const preview = entry.post.content.slice(0, 40).replace(/\n/g, ' ')
      logger.info(`[${completed}/${totalOps}] 🚫 Cancelled ${entry.platform}/${entry.clipType}: "${preview}..."`)
      onProgress?.(completed, totalOps, 'cancelling')
      await new Promise(r => setTimeout(r, 300))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push({ postId: entry.post._id, error: msg })
      failed++
      logger.error(`[${completed}/${totalOps}] ❌ Failed to cancel ${entry.post._id}: ${msg}`)
    }
  }

  // Update posts with new schedule slots
  for (const entry of plan.posts) {
    completed++
    try {
      // Late API schedulePost sends isDraft: false to ensure
      // draft posts transition to scheduled status.
      await client.schedulePost(entry.post._id, entry.newScheduledFor)
      updated++
      const preview = entry.post.content.slice(0, 40).replace(/\n/g, ' ')
      logger.info(`[${completed}/${totalOps}] ✅ ${entry.platform}/${entry.clipType}: "${preview}..." → ${entry.newScheduledFor}`)
      onProgress?.(completed, totalOps, 'updating')

      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 300))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push({ postId: entry.post._id, error: msg })
      failed++
      logger.error(`[${completed}/${totalOps}] ❌ Failed to update ${entry.post._id}: ${msg}`)
    }
  }

  return { updated, cancelled, failed, errors }
}