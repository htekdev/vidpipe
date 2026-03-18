import { LateApiClient } from '../../L2-clients/late/lateApi.js'
import type { LatePost } from '../../L2-clients/late/lateApi.js'
import { loadScheduleConfig, getPlatformSchedule, getDisplacementConfig } from './scheduleConfig.js'
import { getPublishedItems } from '../postStore/postStore.js'
import logger from '../../L1-infra/logger/configLogger.js'
import {
  schedulePost,
  buildBookedMap,
  normalizeDateTime,
  generateTimeslots,
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

// ── Helpers ────────────────────────────────────────────────────────────

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

// ── Scheduling context ─────────────────────────────────────────────────

/**
 * Get the set of Late post IDs that are linked to ideas.
 * Returns empty set on failure (defensive for environments without published items).
 */
async function getIdeaLinkedPostIds(): Promise<Set<string>> {
  try {
    const published = await getPublishedItems()
    const ids = new Set<string>()
    for (const item of published) {
      if (item.metadata.latePostId && item.metadata.ideaIds?.length) {
        ids.add(item.metadata.latePostId)
      }
    }
    return ids
  } catch {
    return new Set()
  }
}

/**
 * Build a ScheduleContext for realign planning.
 * Uses the scheduler's buildBookedMap for the full picture of occupied slots,
 * then removes posts being realigned so their slots are freed for reassignment.
 */
async function buildRealignContext(
  client: LateApiClient,
  timezone: string,
  realignPostIds: Set<string>,
  ideaLinkedPostIds: Set<string>,
  platform?: string,
): Promise<ScheduleContext> {
  let bookedMap: Map<number, BookedSlot>
  try {
    bookedMap = await buildBookedMap(platform)
  } catch {
    bookedMap = new Map()
  }

  // Remove posts being realigned from the booked map (they'll be reassigned)
  for (const [ms, slot] of bookedMap) {
    if (slot.postId && realignPostIds.has(slot.postId)) {
      bookedMap.delete(ms)
    }
  }

  return {
    timezone,
    bookedMap,
    ideaLinkedPostIds,
    lateClient: client,
    displacementEnabled: getDisplacementConfig().enabled,
    dryRun: true,
    depth: 0,
  }
}

// ── Core ───────────────────────────────────────────────────────────────

interface TaggedPost {
  post: LatePost
  platform: string
  clipType: 'short' | 'medium-clip' | 'video'
}

/**
 * Tag each post with platform and clipType from the clipType maps.
 */
function tagPosts(
  allPosts: readonly LatePost[],
  byLatePostId: ReadonlyMap<string, 'short' | 'medium-clip' | 'video'>,
  byContent: ReadonlyMap<string, 'short' | 'medium-clip' | 'video'>,
): { tagged: TaggedPost[]; unmatched: number; contentMatched: number } {
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

  return { tagged, unmatched, contentMatched }
}

/**
 * Build a realignment plan using the scheduler's schedulePost for slot finding.
 * Idea-linked posts are scheduled first and can displace non-idea posts.
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
  const { tagged, unmatched, contentMatched } = tagPosts(allPosts, byLatePostId, byContent)

  if (contentMatched > 0) {
    logger.info(`${contentMatched} post(s) matched by content fallback (no latePostId)`)
  }

  // Build scheduling context
  const realignPostIds = new Set(allPosts.map(p => p._id))
  const ideaLinkedPostIds = await getIdeaLinkedPostIds()
  const ctx = await buildRealignContext(client, timezone, realignPostIds, ideaLinkedPostIds, options.platform)
  const nowMs = Date.now()

  // Sort: idea-linked first (by scheduledFor urgency), then non-idea (by scheduledFor)
  tagged.sort((a, b) => {
    const aIdea = ideaLinkedPostIds.has(a.post._id)
    const bIdea = ideaLinkedPostIds.has(b.post._id)
    if (aIdea !== bIdea) return aIdea ? -1 : 1
    const aTime = a.post.scheduledFor ? new Date(a.post.scheduledFor).getTime() : Infinity
    const bTime = b.post.scheduledFor ? new Date(b.post.scheduledFor).getTime() : Infinity
    return aTime - bTime
  })

  const result: RealignPost[] = []
  const toCancel: CancelPost[] = []
  let skipped = 0

  for (const { post, platform, clipType } of tagged) {
    const schedulePlatform = normalizeSchedulePlatform(platform)
    const platformConfig = getPlatformSchedule(schedulePlatform, clipType)

    if (!platformConfig || platformConfig.slots.length === 0) {
      if (post.status !== 'cancelled') {
        toCancel.push({ post, platform, clipType, reason: `No schedule slots for ${schedulePlatform}/${clipType}` })
      }
      continue
    }

    const isIdeaLinked = ideaLinkedPostIds.has(post._id)
    const label = `realign:${schedulePlatform}/${clipType}:${post._id}`
    const newSlot = await schedulePost(platformConfig, nowMs, isIdeaLinked, label, ctx)

    if (!newSlot) {
      if (post.status !== 'cancelled') {
        toCancel.push({ post, platform, clipType, reason: `No more available slots for ${schedulePlatform}/${clipType}` })
      }
      continue
    }

    // Mark slot in booked map for subsequent posts
    const newMs = normalizeDateTime(newSlot)
    ctx.bookedMap.set(newMs, {
      scheduledFor: newSlot,
      source: 'late',
      postId: post._id,
      platform: schedulePlatform,
      ideaLinked: isIdeaLinked,
    })

    // Skip if already at this slot
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

// ── Prioritized realign ────────────────────────────────────────────────

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
 * Uses the scheduler's generateTimeslots for slot iteration and the shared
 * booked map for conflict detection. Priority rules control which posts get
 * earlier slots via per-slot saturation dice rolls and date-range filtering.
 *
 * @param options.clipTypeMaps - Injectable maps for testing (otherwise fetched from disk)
 */
export async function buildPrioritizedRealignPlan(options: {
  priorities: PriorityRule[]
  platform?: string
  clipTypeMaps?: ClipTypeMaps
} = { priorities: [] }): Promise<RealignPlan> {
  const config = await loadScheduleConfig()
  const { timezone } = config
  const client = new LateApiClient()

  const statuses = ['scheduled', 'draft', 'cancelled', 'failed'] as const
  const allPosts = await fetchAllPosts(client, statuses, options.platform)

  if (allPosts.length === 0) {
    return { posts: [], toCancel: [], skipped: 0, unmatched: 0, totalFetched: 0 }
  }

  const { byLatePostId, byContent } = options.clipTypeMaps ?? await buildClipTypeMaps()
  const { tagged, unmatched, contentMatched } = tagPosts(allPosts, byLatePostId, byContent)

  if (contentMatched > 0) {
    logger.info(`${contentMatched} post(s) matched by content fallback (no latePostId)`)
  }

  // Build scheduling context — start with empty booked map since all fetched
  // posts are being reassigned. Slots are tracked as posts get assigned.
  const ideaLinkedPostIds = await getIdeaLinkedPostIds()
  const bookedMap = new Map<number, BookedSlot>()
  const ctx: ScheduleContext = {
    timezone,
    bookedMap,
    ideaLinkedPostIds,
    lateClient: client,
    displacementEnabled: getDisplacementConfig().enabled,
    dryRun: true,
    depth: 0,
  }
  const nowMs = Date.now()

  // Group by platform+clipType
  const grouped = new Map<string, TaggedPost[]>()
  for (const tp of tagged) {
    const key = `${tp.platform}::${tp.clipType}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(tp)
  }

  const result: RealignPost[] = []
  const toCancel: CancelPost[] = []
  let skipped = 0

  for (const [key, posts] of grouped) {
    const [platform, clipType] = key.split('::')
    const schedulePlatform = normalizeSchedulePlatform(platform)

    const platformConfig = getPlatformSchedule(schedulePlatform, clipType)
    if (!platformConfig || platformConfig.slots.length === 0) {
      for (const { post, clipType: ct } of posts) {
        if (post.status === 'cancelled') continue
        toCancel.push({ post, platform, clipType: ct, reason: `No schedule slots for ${schedulePlatform}/${clipType}` })
      }
      continue
    }

    // Build per-rule queues: posts whose content matches the rule's keywords
    const usedPostIds = new Set<string>()
    const ruleQueues: TaggedPost[][] = options.priorities.map(rule => {
      const matched = posts.filter(tp =>
        tp.post.content && matchesKeywords(tp.post.content, rule.keywords),
      )
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

    // Walk timeslots from the scheduler, skipping already-booked slots
    let assignedCount = 0
    for (const { datetime, ms } of generateTimeslots(platformConfig, timezone, nowMs)) {
      if (assignedCount >= posts.length) break

      // Skip slots booked by non-realign posts
      if (ctx.bookedMap.has(ms)) continue

      let assigned: TaggedPost | undefined

      // Try each priority rule in array order
      for (let r = 0; r < options.priorities.length; r++) {
        const rule = options.priorities[r]
        const queue = ruleQueues[r]

        if (queue.length === 0) continue
        if (!isSlotInRange(datetime, rule, timezone)) continue
        if (Math.random() >= rule.saturation) continue

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
      assignedCount++

      // Mark slot in booked map
      const isIdeaLinked = ideaLinkedPostIds.has(assigned.post._id)
      ctx.bookedMap.set(ms, {
        scheduledFor: datetime,
        source: 'late',
        postId: assigned.post._id,
        platform: schedulePlatform,
        ideaLinked: isIdeaLinked,
      })

      // Skip if already at the correct slot
      const currentMs = assigned.post.scheduledFor ? new Date(assigned.post.scheduledFor).getTime() : 0
      if (currentMs === ms && assigned.post.status === 'scheduled') {
        skipped++
        continue
      }

      result.push({
        post: assigned.post,
        platform: assigned.platform,
        clipType: assigned.clipType,
        oldScheduledFor: assigned.post.scheduledFor ?? null,
        newScheduledFor: datetime,
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
