import { LateApiClient, type LatePost } from '../../L2-clients/late/lateApi.js'
import logger from '../../L1-infra/logger/configLogger.js'
import {
  getPublishedItems,
  getScheduledItemsByIdeaIds,
  updatePublishedItemSchedule,
  type QueueItem,
} from '../postStore/postStore.js'
import {
  getDisplacementConfig,
  getIdeaSpacingConfig,
  getPlatformSchedule,
  loadScheduleConfig,
  type DayOfWeek,
  type PlatformSchedule,
} from './scheduleConfig.js'

// ── Constants ──────────────────────────────────────────────────────────

const MAX_LOOKAHEAD_DAYS = 730
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

// ── Types ──────────────────────────────────────────────────────────────

export interface BookedSlot {
  scheduledFor: string
  source: 'late' | 'local'
  postId?: string
  itemId?: string
  platform: string
  status?: string
  ideaLinked: boolean
  /** Idea IDs linked to this slot (for publishBy comparison during displacement) */
  ideaIds?: string[]
}

export interface SlotOptions {
  ideaIds?: string[]
  publishBy?: string
  /** Pre-built map of ideaId → publishByMs. Used for testing; auto-built from ideaService if omitted. */
  _ideaPublishByMap?: Map<string, number>
}

export interface SlotResult {
  slot: string
  displaced?: {
    postId: string
    originalSlot: string
    newSlot: string
  }
}

interface Timeslot {
  datetime: string
  ms: number
}

interface IdeaRef {
  platform: string
  scheduledForMs: number
}

/**
 * Shared context built once and passed through recursive calls.
 * Avoids re-fetching data on every recursion.
 */
export interface ScheduleContext {
  timezone: string
  bookedMap: Map<number, BookedSlot>
  ideaLinkedPostIds: Set<string>
  lateClient: LateApiClient
  displacementEnabled: boolean
  dryRun: boolean
  depth: number
  /** Idea spacing references — empty when not idea-aware */
  ideaRefs: IdeaRef[]
  samePlatformMs: number
  crossPlatformMs: number
  platform: string
  /** publishBy deadline cap — only applied at depth 0 (primary post, not displaced) */
  publishByMs?: number
  /** Maps ideaId → publishByMs for incumbent publishBy comparison during displacement */
  ideaPublishByMap: Map<string, number>
}

// ── Utility functions ──────────────────────────────────────────────────

function normalizeDateTime(isoString: string): number {
  return new Date(isoString).getTime()
}

function sanitizeLogValue(value: string): string {
  return value.replace(/[\r\n]/g, '')
}

export function getTimezoneOffset(timezone: string, date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  })
  const parts = formatter.formatToParts(date)
  const tzPart = parts.find((part) => part.type === 'timeZoneName')
  const match = tzPart?.value?.match(/GMT([+-]\d{2}:\d{2})/)
  if (match) return match[1]
  if (tzPart?.value === 'GMT') return '+00:00'
  logger.warn(
    `Could not parse timezone offset for timezone "${timezone}" on date "${date.toISOString()}". ` +
    `Raw timeZoneName part: "${tzPart?.value ?? 'undefined'}". Falling back to UTC (+00:00).`,
  )
  return '+00:00'
}

export function buildSlotDatetime(date: Date, time: string, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const yearPart = parts.find((part) => part.type === 'year')?.value
  const monthPart = parts.find((part) => part.type === 'month')?.value
  const dayPart = parts.find((part) => part.type === 'day')?.value

  const year = yearPart ?? String(date.getFullYear())
  const month = (monthPart ?? String(date.getMonth() + 1)).padStart(2, '0')
  const day = (dayPart ?? String(date.getDate())).padStart(2, '0')
  const offset = getTimezoneOffset(timezone, date)
  return `${year}-${month}-${day}T${time}:00${offset}`
}

export function getDayOfWeekInTimezone(date: Date, timezone: string): DayOfWeek {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  })
  const short = formatter.format(date).toLowerCase().slice(0, 3)
  const map: Record<string, DayOfWeek> = {
    sun: 'sun', mon: 'mon', tue: 'tue', wed: 'wed',
    thu: 'thu', fri: 'fri', sat: 'sat',
  }
  return map[short] ?? 'mon'
}

// ── Data fetching ──────────────────────────────────────────────────────

async function fetchScheduledPostsSafe(platform?: string): Promise<LatePost[]> {
  try {
    const client = new LateApiClient()
    return await client.getScheduledPosts(platform)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`Late API unreachable, using local data only: ${msg}`)
    return []
  }
}

/**
 * Build the full booked slot map with idea-linked flags and ideaIds.
 */
export async function buildBookedMap(platform?: string): Promise<Map<number, BookedSlot>> {
  const [latePosts, publishedItems] = await Promise.all([
    fetchScheduledPostsSafe(platform),
    getPublishedItems(),
  ])

  // Build maps from Late post IDs to idea info
  const ideaLinkedPostIds = new Set<string>()
  const latePostIdToIdeaIds = new Map<string, string[]>()
  for (const item of publishedItems) {
    if (item.metadata.latePostId && item.metadata.ideaIds?.length) {
      ideaLinkedPostIds.add(item.metadata.latePostId)
      latePostIdToIdeaIds.set(item.metadata.latePostId, item.metadata.ideaIds)
    }
  }

  const map = new Map<number, BookedSlot>()

  for (const post of latePosts) {
    if (!post.scheduledFor) continue
    for (const scheduledPlatform of post.platforms) {
      if (!platform || scheduledPlatform.platform === platform) {
        const ms = normalizeDateTime(post.scheduledFor)
        map.set(ms, {
          scheduledFor: post.scheduledFor,
          source: 'late',
          postId: post._id,
          platform: scheduledPlatform.platform,
          status: post.status,
          ideaLinked: ideaLinkedPostIds.has(post._id),
          ideaIds: latePostIdToIdeaIds.get(post._id),
        })
      }
    }
  }

  for (const item of publishedItems) {
    if (platform && item.metadata.platform !== platform) continue
    if (!item.metadata.scheduledFor) continue
    const ms = normalizeDateTime(item.metadata.scheduledFor)
    // Don't overwrite Late entries (Late is source of truth for scheduling)
    if (!map.has(ms)) {
      map.set(ms, {
        scheduledFor: item.metadata.scheduledFor,
        source: 'local',
        itemId: item.id,
        platform: item.metadata.platform,
        ideaLinked: Boolean(item.metadata.ideaIds?.length),
        ideaIds: item.metadata.ideaIds,
      })
    }
  }

  return map
}

/**
 * Get the set of Late post IDs that are linked to ideas.
 */
async function getIdeaLinkedLatePostIds(): Promise<Set<string>> {
  const publishedItems = await getPublishedItems()
  const ids = new Set<string>()
  for (const item of publishedItems) {
    if (item.metadata.latePostId && item.metadata.ideaIds?.length) {
      ids.add(item.metadata.latePostId)
    }
  }
  return ids
}

// ── Timeslot generation ────────────────────────────────────────────────

/**
 * Generate timeslots in chronological order for a platform schedule.
 */
function* generateTimeslots(
  platformConfig: PlatformSchedule,
  timezone: string,
  fromMs: number,
  maxMs?: number,
): Generator<Timeslot> {
  const baseDate = new Date(fromMs)
  const upperMs = maxMs ?? fromMs + MAX_LOOKAHEAD_DAYS * DAY_MS

  for (let dayOffset = 0; dayOffset <= MAX_LOOKAHEAD_DAYS; dayOffset++) {
    const day = new Date(baseDate)
    day.setDate(day.getDate() + dayOffset)

    const dayOfWeek = getDayOfWeekInTimezone(day, timezone)
    if (platformConfig.avoidDays.includes(dayOfWeek)) continue

    const dayCandidates: Timeslot[] = []
    for (const slot of platformConfig.slots) {
      if (!slot.days.includes(dayOfWeek)) continue
      const datetime = buildSlotDatetime(day, slot.time, timezone)
      const ms = normalizeDateTime(datetime)
      if (ms <= fromMs) continue
      if (ms > upperMs) continue
      dayCandidates.push({ datetime, ms })
    }
    dayCandidates.sort((a, b) => a.ms - b.ms)
    for (const candidate of dayCandidates) yield candidate

    // Early exit if we've gone past the upper bound
    if (dayCandidates.length === 0) {
      const dayStartMs = normalizeDateTime(buildSlotDatetime(day, '00:00', timezone))
      if (dayStartMs > upperMs) break
    }
  }
}

// ── Spacing ────────────────────────────────────────────────────────────

function passesIdeaSpacing(
  candidateMs: number,
  candidatePlatform: string,
  ideaRefs: readonly IdeaRef[],
  samePlatformMs: number,
  crossPlatformMs: number,
): boolean {
  for (const ref of ideaRefs) {
    const diff = Math.abs(candidateMs - ref.scheduledForMs)
    if (ref.platform === candidatePlatform && diff < samePlatformMs) return false
    if (diff < crossPlatformMs) return false
  }
  return true
}

async function getIdeaReferences(
  ideaIds: string[],
  bookedMap: ReadonlyMap<number, BookedSlot>,
): Promise<IdeaRef[]> {
  const sameIdeaPosts = await getScheduledItemsByIdeaIds(ideaIds)

  const lateSlotsByPostId = new Map<string, BookedSlot[]>()
  const localSlotsByItemId = new Map<string, BookedSlot[]>()
  for (const slot of bookedMap.values()) {
    if (slot.postId) {
      const arr = lateSlotsByPostId.get(slot.postId) ?? []
      arr.push(slot)
      lateSlotsByPostId.set(slot.postId, arr)
    }
    if (slot.itemId) {
      const arr = localSlotsByItemId.get(slot.itemId) ?? []
      arr.push(slot)
      localSlotsByItemId.set(slot.itemId, arr)
    }
  }

  const refs: IdeaRef[] = []
  const seen = new Set<string>()
  const addRef = (platform: string, scheduledFor: string | null | undefined): void => {
    if (!scheduledFor) return
    const key = `${platform}@${scheduledFor}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push({ platform, scheduledForMs: normalizeDateTime(scheduledFor) })
  }

  for (const item of sameIdeaPosts) {
    addRef(item.metadata.platform, item.metadata.scheduledFor)
    if (item.metadata.latePostId) {
      for (const slot of lateSlotsByPostId.get(item.metadata.latePostId) ?? []) {
        addRef(slot.platform, slot.scheduledFor)
      }
    }
    for (const slot of localSlotsByItemId.get(item.id) ?? []) {
      addRef(slot.platform, slot.scheduledFor)
    }
  }

  return refs
}

/**
 * Get the earliest publishBy (ms) for a booked slot's linked ideas.
 * Returns undefined if no publishBy is known.
 */
function getBookedSlotPublishByMs(
  booked: BookedSlot,
  ideaPublishByMap: ReadonlyMap<string, number>,
): number | undefined {
  if (!booked.ideaIds?.length) return undefined
  let earliest: number | undefined
  for (const ideaId of booked.ideaIds) {
    const ms = ideaPublishByMap.get(ideaId)
    if (ms !== undefined && (earliest === undefined || ms < earliest)) {
      earliest = ms
    }
  }
  return earliest
}

/**
 * Build a map of ideaId → publishByMs from the booked map's idea references.
 */
async function buildIdeaPublishByMap(
  bookedMap: ReadonlyMap<number, BookedSlot>,
  lookupIdeaPublishBy: (ideaId: string) => Promise<number | undefined>,
): Promise<Map<string, number>> {
  const allIdeaIds = new Set<string>()
  for (const slot of bookedMap.values()) {
    if (slot.ideaIds) {
      for (const id of slot.ideaIds) allIdeaIds.add(id)
    }
  }

  const map = new Map<string, number>()
  if (allIdeaIds.size === 0) return map

  for (const ideaId of allIdeaIds) {
    const ms = await lookupIdeaPublishBy(ideaId)
    if (ms !== undefined) map.set(ideaId, ms)
  }

  return map
}

/**
 * Create a lookup function that resolves ideaId → publishByMs via ideaService.
 * Uses dynamic import to avoid pulling in the full ideaService dependency tree at load time.
 */
async function createIdeaPublishByLookup(): Promise<(ideaId: string) => Promise<number | undefined>> {
  try {
    const { getIdea } = await import('../ideaService/ideaService.js')
    return async (ideaId: string) => {
      try {
        const idea = await getIdea(parseInt(ideaId, 10))
        if (idea?.publishBy) return new Date(idea.publishBy).getTime()
      } catch { /* idea not found */ }
      return undefined
    }
  } catch {
    return async () => undefined
  }
}

// ── Core recursive scheduler ───────────────────────────────────────────

/**
 * Schedule a post into the next available slot, recursively displacing
 * lower-priority posts as needed.
 *
 * Algorithm for each candidate timeslot:
 *   1. Empty → take it
 *   2. Taken by non-idea post → schedulePost(displaced post, from this slot), take it
 *   3. Taken by idea post → skip (idea posts don't displace each other yet)
 *
 * @param platformConfig  Schedule config for this platform/clipType
 * @param fromMs          Start searching from this timestamp
 * @param isIdeaPost      Whether the post being scheduled is idea-linked
 * @param label           Human-readable label for logging (e.g., "tiktok/short")
 * @param ctx             Shared scheduling context (bookedMap, lateClient, etc.)
 * @returns The scheduled datetime string, or null if no slot found
 */
export async function schedulePost(
  platformConfig: PlatformSchedule,
  fromMs: number,
  isIdeaPost: boolean,
  label: string,
  ctx: ScheduleContext,
): Promise<string | null> {
  const indent = '  '.repeat(ctx.depth)
  let checked = 0
  let skippedBooked = 0
  let skippedSpacing = 0

  // Only cap timeslot search at publishBy for the primary post (depth 0).
  // Displaced posts (depth > 0) are free to go past the deadline.
  const maxMs = ctx.depth === 0 ? ctx.publishByMs : undefined

  logger.debug(`${indent}[schedulePost] Looking for slot for ${label} (idea=${isIdeaPost}) from ${new Date(fromMs).toISOString()}${maxMs ? ` until ${new Date(maxMs).toISOString()}` : ''}`)

  for (const { datetime, ms } of generateTimeslots(platformConfig, ctx.timezone, fromMs, maxMs)) {
    checked++
    const booked = ctx.bookedMap.get(ms)

    // ── Case 1: Empty slot → check spacing then take it ───────────
    if (!booked) {
      // Check idea spacing — skip slots too close to same-idea posts
      if (isIdeaPost && ctx.ideaRefs.length > 0 &&
          !passesIdeaSpacing(ms, ctx.platform, ctx.ideaRefs, ctx.samePlatformMs, ctx.crossPlatformMs)) {
        skippedSpacing++
        if (skippedSpacing <= 5 || skippedSpacing % 50 === 0) {
          logger.debug(`${indent}[schedulePost] ⏭️ Slot ${datetime} too close to same-idea post — skipping`)
        }
        continue
      }
      logger.info(`${indent}[schedulePost] ✅ Found empty slot: ${datetime} (checked ${checked}, skipped ${skippedBooked} booked, ${skippedSpacing} spacing)`)
      return datetime
    }

    // ── Case 2: Taken by non-idea Late post → displace it ──────────
    if (isIdeaPost && ctx.displacementEnabled && !booked.ideaLinked && booked.source === 'late' && booked.postId) {
      // Check spacing before displacing — no point if we can't use the slot
      if (ctx.ideaRefs.length > 0 &&
          !passesIdeaSpacing(ms, ctx.platform, ctx.ideaRefs, ctx.samePlatformMs, ctx.crossPlatformMs)) {
        skippedSpacing++
        if (skippedSpacing <= 5 || skippedSpacing % 50 === 0) {
          logger.debug(`${indent}[schedulePost] ⏭️ Slot ${datetime} too close to same-idea post — skipping (even though displaceable)`)
        }
        continue
      }
      logger.info(`${indent}[schedulePost] 🔄 Slot ${datetime} taken by non-idea post ${booked.postId} — displacing`)

      // Recursively find a new home for the displaced post
      const newHome = await schedulePost(
        platformConfig,
        ms,
        false,
        `displaced:${booked.postId}`,
        { ...ctx, depth: ctx.depth + 1 },
      )

      if (newHome) {
        // Move the displaced post
        if (!ctx.dryRun) {
          try {
            await ctx.lateClient.schedulePost(booked.postId, newHome)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            logger.warn(`${indent}[schedulePost] ⚠️ Failed to displace ${booked.postId} via Late API: ${msg} — skipping slot`)
            continue
          }
        }
        logger.info(`${indent}[schedulePost] 📦 Displaced ${booked.postId}: ${datetime} → ${newHome}`)

        // Update the booked map
        ctx.bookedMap.delete(ms)
        const newMs = normalizeDateTime(newHome)
        ctx.bookedMap.set(newMs, { ...booked, scheduledFor: newHome })

        logger.info(`${indent}[schedulePost] ✅ Taking slot: ${datetime} (checked ${checked}, displaced ${booked.postId})`)
        return datetime
      }

      // Could not find a new home for displaced post — skip this slot
      logger.warn(`${indent}[schedulePost] ⚠️ Could not displace ${booked.postId} — no empty slot found after ${datetime}`)
    }

    // ── Case 3: Taken by idea post ──────────────────────────────────
    if (booked.ideaLinked) {
      // publishBy-aware displacement: soonest deadline wins the slot
      if (isIdeaPost && ctx.displacementEnabled && ctx.publishByMs && booked.source === 'late' && booked.postId) {
        const incumbentPublishByMs = getBookedSlotPublishByMs(booked, ctx.ideaPublishByMap)

        // Our post wins if: (a) incumbent has no deadline, or (b) our deadline is sooner
        if (!incumbentPublishByMs || ctx.publishByMs < incumbentPublishByMs) {
          // Check spacing before displacing
          if (ctx.ideaRefs.length > 0 &&
              !passesIdeaSpacing(ms, ctx.platform, ctx.ideaRefs, ctx.samePlatformMs, ctx.crossPlatformMs)) {
            skippedSpacing++
            if (skippedSpacing <= 5 || skippedSpacing % 50 === 0) {
              logger.debug(`${indent}[schedulePost] ⏭️ Slot ${datetime} too close to same-idea post — skipping (even though idea-displaceable)`)
            }
            continue
          }

          logger.info(`${indent}[schedulePost] 🔄 Slot ${datetime} taken by idea post ${booked.postId} with later deadline — displacing`)

          // Displaced idea post keeps its own publishBy for further comparisons
          const newHome = await schedulePost(
            platformConfig, ms, true,
            `displaced-idea:${booked.postId}`,
            { ...ctx, depth: ctx.depth + 1, publishByMs: incumbentPublishByMs },
          )

          if (newHome) {
            if (!ctx.dryRun) {
              try {
                await ctx.lateClient.schedulePost(booked.postId, newHome)
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                logger.warn(`${indent}[schedulePost] ⚠️ Failed to displace idea ${booked.postId} via Late API: ${msg} — skipping slot`)
                continue
              }
            }
            logger.info(`${indent}[schedulePost] 📦 Displaced idea ${booked.postId}: ${datetime} → ${newHome}`)

            ctx.bookedMap.delete(ms)
            const newMs = normalizeDateTime(newHome)
            ctx.bookedMap.set(newMs, { ...booked, scheduledFor: newHome })

            logger.info(`${indent}[schedulePost] ✅ Taking slot: ${datetime} (checked ${checked}, displaced idea ${booked.postId})`)
            return datetime
          }

          logger.warn(`${indent}[schedulePost] ⚠️ Could not displace idea ${booked.postId} — no slot found after ${datetime}`)
        }
      }

      // Can't displace (no publishBy, incumbent has sooner deadline, or displacement failed) — skip
      skippedBooked++
      if (skippedBooked <= 5 || skippedBooked % 50 === 0) {
        logger.debug(`${indent}[schedulePost] ⏭️ Slot ${datetime} taken by idea post ${booked.postId ?? booked.itemId} — skipping`)
      }
      continue
    }

    // ── Non-idea post but displacement not available ────────────────
    skippedBooked++
    if (skippedBooked <= 5 || skippedBooked % 50 === 0) {
      logger.debug(`${indent}[schedulePost] ⏭️ Slot ${datetime} taken (${booked.source}/${booked.postId ?? booked.itemId}) — skipping`)
    }
  }

  logger.warn(`[schedulePost] ❌ No slot found for ${label} — checked ${checked} candidates, skipped ${skippedBooked} booked, ${skippedSpacing} spacing`)
  return null
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Find the next available posting slot for a platform.
 * Uses recursive displacement: idea posts bump non-idea posts to later slots.
 * When publishBy is set, uses two-pass scheduling:
 *   Pass 1: Search only slots before the publishBy deadline
 *   Pass 2 (fallback): Search all slots if nothing available before deadline
 */
export async function findNextSlot(
  platform: string,
  clipType?: string,
  options?: SlotOptions,
): Promise<string | null> {
  const config = await loadScheduleConfig()
  const platformConfig = getPlatformSchedule(platform, clipType)
  if (!platformConfig) {
    logger.warn(`No schedule config found for platform "${sanitizeLogValue(platform)}"`)
    return null
  }

  const { timezone } = config
  const nowMs = Date.now()
  const ideaIds = options?.ideaIds?.filter(Boolean) ?? []
  const isIdeaAware = ideaIds.length > 0
  const publishBy = options?.publishBy
  const publishByMs = publishBy ? new Date(publishBy).getTime() : undefined

  // Build shared context
  const bookedMap = await buildBookedMap(platform)
  const ideaLinkedPostIds = await getIdeaLinkedLatePostIds()
  const label = `${platform}/${clipType ?? 'default'}`

  // Build idea spacing references if idea-aware
  let ideaRefs: IdeaRef[] = []
  let samePlatformMs = 0
  let crossPlatformMs = 0
  if (isIdeaAware) {
    const allBookedMap = await buildBookedMap()
    ideaRefs = await getIdeaReferences(ideaIds, allBookedMap)
    const spacingConfig = getIdeaSpacingConfig()
    samePlatformMs = spacingConfig.samePlatformHours * HOUR_MS
    crossPlatformMs = spacingConfig.crossPlatformHours * HOUR_MS
  }

  // Build publishBy map for incumbent idea posts (needed for idea-vs-idea displacement)
  let ideaPublishByMap: Map<string, number>
  if (options?._ideaPublishByMap) {
    ideaPublishByMap = options._ideaPublishByMap
  } else if (publishByMs && Number.isFinite(publishByMs) && publishByMs > nowMs) {
    const lookup = await createIdeaPublishByLookup()
    ideaPublishByMap = await buildIdeaPublishByMap(bookedMap, lookup)
  } else {
    ideaPublishByMap = new Map<string, number>()
  }

  logger.info(`[findNextSlot] Scheduling ${label} (idea=${isIdeaAware}, booked=${bookedMap.size} slots, spacingRefs=${ideaRefs.length}${publishBy ? `, publishBy=${publishBy}` : ''})`)

  const ctx: ScheduleContext = {
    timezone,
    bookedMap,
    ideaLinkedPostIds,
    lateClient: new LateApiClient(),
    displacementEnabled: getDisplacementConfig().enabled,
    dryRun: false,
    depth: 0,
    ideaRefs,
    samePlatformMs,
    crossPlatformMs,
    platform,
    ideaPublishByMap,
  }

  // Two-pass scheduling when publishBy is set and in the future
  let result: string | null = null
  if (publishByMs && Number.isFinite(publishByMs) && publishByMs > nowMs) {
    // Pass 1: try to find a slot before the publishBy deadline
    result = await schedulePost(platformConfig, nowMs, isIdeaAware, label, { ...ctx, publishByMs })

    if (!result) {
      // Pass 2: no slot before deadline — search past it as fallback
      logger.warn(`[findNextSlot] ⚠️ No slot for ${label} before publishBy ${publishBy} — searching past deadline`)
      result = await schedulePost(platformConfig, nowMs, isIdeaAware, label, { ...ctx, publishByMs: undefined })
    }
  } else {
    // No publishBy or already passed — search without cap
    result = await schedulePost(platformConfig, nowMs, isIdeaAware, label, { ...ctx, publishByMs: undefined })
  }

  if (!result) {
    logger.warn(`[findNextSlot] ❌ No available slot for "${sanitizeLogValue(platform)}" within ${MAX_LOOKAHEAD_DAYS} days`)
  } else if (publishByMs && Number.isFinite(publishByMs)) {
    const slotMs = new Date(result).getTime()
    if (slotMs > publishByMs) {
      const daysLate = Math.ceil((slotMs - publishByMs) / (24 * 60 * 60 * 1000))
      logger.warn(`[findNextSlot] ⚠️ ${label} scheduled for ${result} — ${daysLate} day(s) AFTER publishBy deadline ${publishBy}`)
    } else {
      logger.info(`[findNextSlot] ✅ ${label} → ${result} (within publishBy ${publishBy})`)
    }
  } else {
    logger.info(`[findNextSlot] ✅ ${label} → ${result}`)
  }

  return result
}

// ── Reschedule idea posts ──────────────────────────────────────────────

export interface RescheduleResult {
  rescheduled: number
  unchanged: number
  failed: number
  details: Array<{
    itemId: string
    platform: string
    latePostId: string
    oldSlot: string | null
    newSlot: string | null
    error?: string
  }>
}

/**
 * Reschedule all idea-linked posts through the recursive scheduling logic.
 * Idea posts get priority — non-idea posts in their way get displaced.
 * Existing Late posts are updated in-place (not re-uploaded).
 */
export async function rescheduleIdeaPosts(options?: { dryRun?: boolean }): Promise<RescheduleResult> {
  const dryRun = options?.dryRun ?? false
  const config = await loadScheduleConfig()
  const { timezone } = config

  const publishedItems = await getPublishedItems()
  const ideaPosts = publishedItems.filter(
    (item) => item.metadata.ideaIds?.length && item.metadata.latePostId,
  )

  if (ideaPosts.length === 0) {
    logger.info('No idea-linked posts to reschedule')
    return { rescheduled: 0, unchanged: 0, failed: 0, details: [] }
  }

  logger.info(`Found ${ideaPosts.length} idea-linked posts to reschedule`)

  // Build booked map EXCLUDING idea posts (they'll be reassigned)
  const ideaLatePostIds = new Set(ideaPosts.map((item) => item.metadata.latePostId!))
  const fullBookedMap = await buildBookedMap()
  // Remove idea posts from the map so their slots are free
  for (const [ms, slot] of fullBookedMap) {
    if (slot.postId && ideaLatePostIds.has(slot.postId)) {
      fullBookedMap.delete(ms)
    }
  }

  // Sort idea posts by urgency: earliest publishBy first (hot-trend before evergreen)
  const lookup = await createIdeaPublishByLookup()
  const ideaPublishByMap = new Map<string, string>()
  for (const item of ideaPosts) {
    const ideaId = item.metadata.ideaIds?.[0]
    if (ideaId && !ideaPublishByMap.has(ideaId)) {
      const publishByMs = await lookup(ideaId)
      if (publishByMs !== undefined) {
        ideaPublishByMap.set(ideaId, new Date(publishByMs).toISOString())
      }
    }
  }

  ideaPosts.sort((a, b) => {
    const aId = a.metadata.ideaIds?.[0]
    const bId = b.metadata.ideaIds?.[0]
    const aDate = aId ? ideaPublishByMap.get(aId) ?? '9999' : '9999'
    const bDate = bId ? ideaPublishByMap.get(bId) ?? '9999' : '9999'
    return aDate.localeCompare(bDate)
  })

  const lateClient = new LateApiClient()
  const result: RescheduleResult = { rescheduled: 0, unchanged: 0, failed: 0, details: [] }
  const nowMs = Date.now()

  // Convert the string publishBy map to numeric for ScheduleContext
  const ideaPublishByMsMap = new Map<string, number>()
  for (const [ideaId, dateStr] of ideaPublishByMap) {
    ideaPublishByMsMap.set(ideaId, new Date(dateStr).getTime())
  }

  const ctx: ScheduleContext = {
    timezone,
    bookedMap: fullBookedMap,
    ideaLinkedPostIds: new Set<string>(),
    lateClient,
    displacementEnabled: getDisplacementConfig().enabled,
    dryRun,
    depth: 0,
    ideaRefs: [],
    samePlatformMs: 0,
    crossPlatformMs: 0,
    platform: '',
    ideaPublishByMap: ideaPublishByMsMap,
  }

  for (const item of ideaPosts) {
    const platform = item.metadata.platform
    const clipType = item.metadata.clipType
    const latePostId = item.metadata.latePostId!
    const oldSlot = item.metadata.scheduledFor
    const label = `${item.id} (${platform}/${clipType})`

    try {
      const platformConfig = getPlatformSchedule(platform, clipType)
      if (!platformConfig) {
        result.details.push({ itemId: item.id, platform, latePostId, oldSlot, newSlot: null, error: 'No schedule config' })
        result.failed++
        continue
      }

      const newSlotDatetime = await schedulePost(platformConfig, nowMs, true, label, ctx)

      if (!newSlotDatetime) {
        result.details.push({ itemId: item.id, platform, latePostId, oldSlot, newSlot: null, error: 'No slot found' })
        result.failed++
        continue
      }

      const newSlotMs = normalizeDateTime(newSlotDatetime)

      if (oldSlot && normalizeDateTime(oldSlot) === newSlotMs) {
        result.details.push({ itemId: item.id, platform, latePostId, oldSlot, newSlot: newSlotDatetime })
        result.unchanged++
        // Mark this slot as taken in the map
        ctx.bookedMap.set(newSlotMs, {
          scheduledFor: newSlotDatetime, source: 'late', postId: latePostId,
          platform, ideaLinked: true,
        })
        continue
      }

      if (!dryRun) {
        try {
          await lateClient.schedulePost(latePostId, newSlotDatetime)
        } catch (scheduleErr) {
          const errMsg = scheduleErr instanceof Error ? scheduleErr.message : String(scheduleErr)
          // Late API returns 400 for already-published posts — skip gracefully
          if (errMsg.includes('Published posts can only have their recycling config updated')) {
            logger.info(`Skipping ${label}: post already published on platform`)
            result.details.push({ itemId: item.id, platform, latePostId, oldSlot, newSlot: null, error: 'Already published — skipped' })
            result.unchanged++
            continue
          }
          throw scheduleErr
        }
        await updatePublishedItemSchedule(item.id, newSlotDatetime)
      }

      // Mark this slot as taken in the map
      ctx.bookedMap.set(newSlotMs, {
        scheduledFor: newSlotDatetime, source: 'late', postId: latePostId,
        platform, ideaLinked: true,
      })

      logger.info(`Rescheduled ${label}: ${oldSlot ?? 'unscheduled'} → ${newSlotDatetime}`)
      result.details.push({ itemId: item.id, platform, latePostId, oldSlot, newSlot: newSlotDatetime })
      result.rescheduled++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`Failed to reschedule ${label}: ${msg}`)
      result.details.push({ itemId: item.id, platform, latePostId, oldSlot, newSlot: null, error: msg })
      result.failed++
    }
  }

  logger.info(`Reschedule complete: ${result.rescheduled} moved, ${result.unchanged} unchanged, ${result.failed} failed`)
  return result
}

// ── Calendar ───────────────────────────────────────────────────────────

/**
 * Get a calendar view of scheduled posts across all platforms.
 */
export async function getScheduleCalendar(
  startDate?: Date,
  endDate?: Date,
): Promise<Array<{
  platform: string
  scheduledFor: string
  source: 'late' | 'local'
  postId?: string
  itemId?: string
}>> {
  const bookedMap = await buildBookedMap()

  let filtered = [...bookedMap.values()]
    .filter((slot) => slot.source === 'local' || slot.status === 'scheduled')
    .map((slot) => ({
      platform: slot.platform,
      scheduledFor: slot.scheduledFor,
      source: slot.source,
      postId: slot.postId,
      itemId: slot.itemId,
    }))

  if (startDate) {
    const startMs = startDate.getTime()
    filtered = filtered.filter((slot) => normalizeDateTime(slot.scheduledFor) >= startMs)
  }
  if (endDate) {
    const endMs = endDate.getTime()
    filtered = filtered.filter((slot) => normalizeDateTime(slot.scheduledFor) <= endMs)
  }

  filtered.sort((left, right) => normalizeDateTime(left.scheduledFor) - normalizeDateTime(right.scheduledFor))
  return filtered
}
