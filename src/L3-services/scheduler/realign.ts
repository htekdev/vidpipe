import { LateApiClient } from '../../L2-clients/late/lateApi.js'
import type { LatePost } from '../../L2-clients/late/lateApi.js'
import { loadScheduleConfig, getPlatformSchedule, type DayOfWeek } from './scheduleConfig.js'
import { getPublishedItems } from '../postStore/postStore.js'
import logger from '../../L1-infra/logger/configLogger.js'

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

// ── Helpers ────────────────────────────────────────────────────────────

function getTimezoneOffset(timezone: string, date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  })
  const parts = formatter.formatToParts(date)
  const tzPart = parts.find(p => p.type === 'timeZoneName')
  const match = tzPart?.value?.match(/GMT([+-]\d{2}:\d{2})/)
  if (match) return match[1]
  if (tzPart?.value === 'GMT') return '+00:00'
  return '+00:00'
}

function buildSlotDatetime(date: Date, time: string, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const year = parts.find(p => p.type === 'year')?.value ?? String(date.getFullYear())
  const month = (parts.find(p => p.type === 'month')?.value ?? String(date.getMonth() + 1)).padStart(2, '0')
  const day = (parts.find(p => p.type === 'day')?.value ?? String(date.getDate())).padStart(2, '0')
  const offset = getTimezoneOffset(timezone, date)
  return `${year}-${month}-${day}T${time}:00${offset}`
}

function getDayOfWeekInTimezone(date: Date, timezone: string): DayOfWeek {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  })
  const short = formatter.format(date).toLowerCase().slice(0, 3)
  const map: Record<string, DayOfWeek> = {
    sun: 'sun', mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat',
  }
  return map[short] ?? 'mon'
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

interface ClipTypeMaps {
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
    // Build content-based fallback using post.md content + platform as key
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
  platform: string,
  clipType: string,
  timezone: string,
): boolean {
  const schedule = getPlatformSchedule(platform, clipType)
  if (!schedule || schedule.slots.length === 0) return false

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

/**
 * Generate candidate slot datetimes for a platform+clipType, skipping booked slots.
 */
function generateSlots(
  platform: string,
  clipType: string,
  count: number,
  bookedMs: Set<number>,
  timezone: string,
): string[] {
  const schedule = getPlatformSchedule(platform, clipType)
  if (!schedule || schedule.slots.length === 0) {
    logger.warn(`No schedule slots for ${platform}/${clipType}`)
    return []
  }

  const available: string[] = []
  const now = new Date()
  const nowMs = now.getTime()

  for (let dayOffset = 0; dayOffset < 730 && available.length < count; dayOffset++) {
    const day = new Date(now)
    day.setDate(day.getDate() + dayOffset)

    const dayOfWeek = getDayOfWeekInTimezone(day, timezone)
    if (schedule.avoidDays.includes(dayOfWeek)) continue

    for (const slot of schedule.slots) {
      if (available.length >= count) break
      if (!slot.days.includes(dayOfWeek)) continue

      const iso = buildSlotDatetime(day, slot.time, timezone)
      const ms = new Date(iso).getTime()
      if (ms <= nowMs) continue // skip slots in the past
      if (!bookedMs.has(ms)) {
        available.push(iso)
        bookedMs.add(ms)
      }
    }
  }

  return available
}

/**
 * Build a realignment plan: determine new scheduledFor for each post.
 */
export async function buildRealignPlan(options: {
  platform?: string
} = {}): Promise<RealignPlan> {
  const config = await loadScheduleConfig()
  const { timezone } = config
  const client = new LateApiClient()

  // Fetch all posts that need realignment
  const statuses = ['scheduled', 'draft', 'cancelled', 'failed'] as const
  const allPosts = await fetchAllPosts(client, statuses, options.platform)

  if (allPosts.length === 0) {
    return { posts: [], toCancel: [], skipped: 0, unmatched: 0, totalFetched: 0 }
  }

  // Build clipType maps from local published metadata
  const { byLatePostId, byContent } = await buildClipTypeMaps()

  // Group posts by platform+clipType
  const grouped = new Map<string, Array<{ post: LatePost; platform: string; clipType: 'short' | 'medium-clip' | 'video' }>>()
  let unmatched = 0
  let contentMatched = 0

  for (const post of allPosts) {
    const platform = post.platforms[0]?.platform
    if (!platform) continue

    // Primary: match by latePostId
    let clipType = byLatePostId.get(post._id) ?? null

    // Fallback: match by normalized content
    if (!clipType && post.content) {
      const contentKey = `${platform}::${normalizeContent(post.content)}`
      clipType = byContent.get(contentKey) ?? null
      if (clipType) contentMatched++
    }

    if (!clipType) {
      clipType = 'short'
      unmatched++
    }

    const key = `${platform}::${clipType}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push({ post, platform, clipType })
  }

  // Track globally booked slots across all platforms
  const bookedMs = new Set<number>()

  if (contentMatched > 0) {
    logger.info(`${contentMatched} post(s) matched by content fallback (no latePostId)`)
  }

  // Assign ALL posts to slots from today, compacting the schedule to fill gaps.
  // Posts whose new slot matches their current slot are skipped (no update needed).
  const result: RealignPost[] = []
  const toCancel: CancelPost[] = []
  let skipped = 0

  for (const [key, posts] of grouped) {
    const [platform, clipType] = key.split('::')
    const schedulePlatform = normalizeSchedulePlatform(platform)

    // Check if this platform+clipType has any schedule config
    const schedule = getPlatformSchedule(schedulePlatform, clipType)
    const hasSlots = schedule && schedule.slots.length > 0

    if (!hasSlots) {
      // No schedule slots — cancel these posts (unless already cancelled)
      for (const { post, clipType: ct } of posts) {
        if (post.status === 'cancelled') continue
        toCancel.push({
          post,
          platform,
          clipType: ct,
          reason: `No schedule slots for ${schedulePlatform}/${clipType}`,
        })
      }
      continue
    }

    // Sort by original scheduledFor (earliest first), unscheduled at the end
    posts.sort((a, b) => {
      const aTime = a.post.scheduledFor ? new Date(a.post.scheduledFor).getTime() : Infinity
      const bTime = b.post.scheduledFor ? new Date(b.post.scheduledFor).getTime() : Infinity
      return aTime - bTime
    })

    const slots = generateSlots(schedulePlatform, clipType, posts.length, bookedMs, timezone)

    for (let i = 0; i < posts.length; i++) {
      const { post } = posts[i]
      const newSlot = slots[i]
      if (!newSlot) {
        // Ran out of slots — cancel overflow posts (unless already cancelled)
        if (post.status !== 'cancelled') {
          toCancel.push({
            post,
            platform,
            clipType: posts[i].clipType,
            reason: `No more available slots for ${schedulePlatform}/${clipType}`,
          })
        }
        continue
      }

      // Skip if already scheduled at this exact slot and status is fine
      const currentMs = post.scheduledFor ? new Date(post.scheduledFor).getTime() : 0
      const newMs = new Date(newSlot).getTime()
      if (currentMs === newMs && post.status === 'scheduled') {
        skipped++
        continue
      }

      result.push({
        post,
        platform,
        clipType: posts[i].clipType,
        oldScheduledFor: post.scheduledFor ?? null,
        newScheduledFor: newSlot,
      })
    }
  }

  // Sort final plan chronologically by new slot
  result.sort((a, b) => new Date(a.newScheduledFor).getTime() - new Date(b.newScheduledFor).getTime())

  return { posts: result, toCancel, skipped, unmatched, totalFetched: allPosts.length }
}

// ── Prioritized realign ────────────────────────────────────────────────

interface TaggedPost {
  post: LatePost
  platform: string
  clipType: 'short' | 'medium-clip' | 'video'
}

/**
 * Check if a slot date (YYYY-MM-DD in schedule timezone) falls within a rule's active range.
 */
function isSlotInRange(slotIso: string, rule: PriorityRule, timezone: string): boolean {
  if (!rule.from && !rule.to) return true
  const date = new Date(slotIso)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const year = parts.find(p => p.type === 'year')?.value ?? ''
  const month = parts.find(p => p.type === 'month')?.value ?? ''
  const day = parts.find(p => p.type === 'day')?.value ?? ''
  const slotDate = `${year}-${month}-${day}`
  if (rule.from && slotDate < rule.from) return false
  if (rule.to && slotDate > rule.to) return false
  return true
}

/**
 * Check if a post's content matches any of the keywords (case-insensitive substring).
 */
function matchesKeywords(content: string, keywords: readonly string[]): boolean {
  const lower = content.toLowerCase()
  return keywords.some(kw => lower.includes(kw.toLowerCase()))
}

/**
 * Build a prioritized realignment plan.
 *
 * Works like `buildRealignPlan` but reorders posts per platform+clipType group
 * using priority rules before assigning to slots. For each slot, the rules are
 * checked in array order:
 *   1. If the slot date is in the rule's {from, to} range
 *   2. AND Math.random() < saturation
 *   → pull the next keyword-matched post from that rule's queue
 * If no rule fires, pull from the remaining (non-priority) pool sorted by scheduledFor.
 */
export async function buildPrioritizedRealignPlan(options: {
  priorities: PriorityRule[]
  platform?: string
} = { priorities: [] }): Promise<RealignPlan> {
  const config = await loadScheduleConfig()
  const { timezone } = config
  const client = new LateApiClient()

  const statuses = ['scheduled', 'draft', 'cancelled', 'failed'] as const
  const allPosts = await fetchAllPosts(client, statuses, options.platform)

  if (allPosts.length === 0) {
    return { posts: [], toCancel: [], skipped: 0, unmatched: 0, totalFetched: 0 }
  }

  const { byLatePostId, byContent } = await buildClipTypeMaps()

  // Tag each post with platform + clipType
  const tagged: TaggedPost[] = []
  let unmatched = 0
  let contentMatched = 0

  for (const post of allPosts) {
    const platform = post.platforms[0]?.platform
    if (!platform) continue

    let clipType = byLatePostId.get(post._id) ?? null
    if (!clipType && post.content) {
      const contentKey = `${platform}::${normalizeContent(post.content)}`
      clipType = byContent.get(contentKey) ?? null
      if (clipType) contentMatched++
    }
    if (!clipType) {
      clipType = 'short'
      unmatched++
    }
    tagged.push({ post, platform, clipType })
  }

  if (contentMatched > 0) {
    logger.info(`${contentMatched} post(s) matched by content fallback (no latePostId)`)
  }

  // Group by platform+clipType
  const grouped = new Map<string, TaggedPost[]>()
  for (const tp of tagged) {
    const key = `${tp.platform}::${tp.clipType}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(tp)
  }

  const bookedMs = new Set<number>()
  const result: RealignPost[] = []
  const toCancel: CancelPost[] = []
  let skipped = 0

  for (const [key, posts] of grouped) {
    const [platform, clipType] = key.split('::')
    const schedulePlatform = normalizeSchedulePlatform(platform)

    const schedule = getPlatformSchedule(schedulePlatform, clipType)
    const hasSlots = schedule && schedule.slots.length > 0

    if (!hasSlots) {
      for (const { post, clipType: ct } of posts) {
        if (post.status === 'cancelled') continue
        toCancel.push({ post, platform, clipType: ct, reason: `No schedule slots for ${schedulePlatform}/${clipType}` })
      }
      continue
    }

    const slots = generateSlots(schedulePlatform, clipType, posts.length, bookedMs, timezone)

    // Build per-rule queues: posts whose content matches the rule's keywords
    const usedPostIds = new Set<string>()
    const ruleQueues: TaggedPost[][] = options.priorities.map(rule => {
      const matched = posts.filter(tp =>
        tp.post.content && matchesKeywords(tp.post.content, rule.keywords),
      )
      // Sort matched by scheduledFor (earliest first)
      matched.sort((a, b) => {
        const at = a.post.scheduledFor ? new Date(a.post.scheduledFor).getTime() : Infinity
        const bt = b.post.scheduledFor ? new Date(b.post.scheduledFor).getTime() : Infinity
        return at - bt
      })
      return matched
    })

    // Collect IDs of posts matched by any priority rule
    const priorityMatchedIds = new Set<string>()
    for (const queue of ruleQueues) {
      for (const tp of queue) {
        priorityMatchedIds.add(tp.post._id)
      }
    }

    // Remaining pool: ONLY posts that don't match any priority rule.
    // Priority-matched posts are reserved for their rule queues — they are only
    // assignable when a rule fires. This prevents them from being consumed by
    // earlier slots before the rule's date range starts.
    const remainingPool = posts
      .filter(tp => !priorityMatchedIds.has(tp.post._id))
      .sort((a, b) => {
        const at = a.post.scheduledFor ? new Date(a.post.scheduledFor).getTime() : Infinity
        const bt = b.post.scheduledFor ? new Date(b.post.scheduledFor).getTime() : Infinity
        return at - bt
      })
    let remainingIdx = 0

    // Walk each slot and decide which post to assign
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      let assigned: TaggedPost | undefined

      // Try each priority rule in array order
      for (let r = 0; r < options.priorities.length; r++) {
        const rule = options.priorities[r]
        const queue = ruleQueues[r]

        // Skip exhausted queues
        if (queue.length === 0) continue

        // Check if this slot's date is in the rule's active range
        if (!isSlotInRange(slot, rule, timezone)) continue

        // Saturation dice roll
        if (Math.random() >= rule.saturation) continue

        // Find next unused post from this queue
        while (queue.length > 0) {
          const candidate = queue.shift()!
          if (!usedPostIds.has(candidate.post._id)) {
            assigned = candidate
            usedPostIds.add(candidate.post._id)
            break
          }
        }
        if (assigned) break
      }

      // Fallback: pull from remaining pool
      if (!assigned) {
        while (remainingIdx < remainingPool.length) {
          const candidate = remainingPool[remainingIdx]
          remainingIdx++
          if (!usedPostIds.has(candidate.post._id)) {
            assigned = candidate
            usedPostIds.add(candidate.post._id)
            break
          }
        }
      }

      if (!assigned) continue

      // Skip if already at the correct slot
      const currentMs = assigned.post.scheduledFor ? new Date(assigned.post.scheduledFor).getTime() : 0
      const newMs = new Date(slot).getTime()
      if (currentMs === newMs && assigned.post.status === 'scheduled') {
        skipped++
        continue
      }

      result.push({
        post: assigned.post,
        platform: assigned.platform,
        clipType: assigned.clipType,
        oldScheduledFor: assigned.post.scheduledFor ?? null,
        newScheduledFor: slot,
      })
    }

    // Cancel posts that didn't get a slot
    for (const tp of posts) {
      if (usedPostIds.has(tp.post._id)) continue
      if (tp.post.status === 'cancelled') continue
      toCancel.push({
        post: tp.post,
        platform: tp.platform,
        clipType: tp.clipType,
        reason: `No more available slots for ${schedulePlatform}/${clipType}`,
      })
    }
  }

  result.sort((a, b) => new Date(a.newScheduledFor).getTime() - new Date(b.newScheduledFor).getTime())

  return { posts: result, toCancel, skipped, unmatched, totalFetched: allPosts.length }
}

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
      const updates: Record<string, unknown> = {
        scheduledFor: entry.newScheduledFor,
      }

      // Reactivate draft/cancelled/failed posts
      if (entry.post.status !== 'scheduled') {
        updates.status = 'scheduled'
      }

      await client.updatePost(entry.post._id, updates)
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
