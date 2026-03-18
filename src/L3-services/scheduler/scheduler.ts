import { LateApiClient, type LatePost } from '../../L2-clients/late/lateApi.js'
import logger from '../../L1-infra/logger/configLogger.js'
import {
  getPublishedItems,
  getScheduledItemsByIdeaIds,
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

interface BookedSlot {
  scheduledFor: string
  source: 'late' | 'local'
  postId?: string
  itemId?: string
  platform: string
  status?: string
}

export interface SlotOptions {
  ideaIds?: string[]
  publishBy?: string
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

// ── Utility functions ──────────────────────────────────────────────────

function normalizeDateTime(isoString: string): number {
  return new Date(isoString).getTime()
}

function sanitizeLogValue(value: string): string {
  return value.replace(/[\r\n]/g, '')
}

function getTimezoneOffset(timezone: string, date: Date): string {
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

function buildSlotDatetime(date: Date, time: string, timezone: string): string {
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

function getDayOfWeekInTimezone(date: Date, timezone: string): DayOfWeek {
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

async function buildBookedSlots(platform?: string): Promise<BookedSlot[]> {
  const [latePosts, publishedItems] = await Promise.all([
    fetchScheduledPostsSafe(platform),
    getPublishedItems(),
  ])

  const slots: BookedSlot[] = []

  for (const post of latePosts) {
    if (!post.scheduledFor) continue
    for (const scheduledPlatform of post.platforms) {
      if (!platform || scheduledPlatform.platform === platform) {
        slots.push({
          scheduledFor: post.scheduledFor,
          source: 'late',
          postId: post._id,
          platform: scheduledPlatform.platform,
          status: post.status,
        })
      }
    }
  }

  for (const item of publishedItems) {
    if (platform && item.metadata.platform !== platform) continue
    if (!item.metadata.scheduledFor) continue
    slots.push({
      scheduledFor: item.metadata.scheduledFor,
      source: 'local',
      itemId: item.id,
      platform: item.metadata.platform,
    })
  }

  return slots
}

/**
 * Get the set of Late post IDs that are linked to ideas.
 * Any Late post NOT in this set is non-idea content and can be displaced.
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
 * @param fromMs  - only yield slots after this timestamp
 * @param maxMs   - stop yielding slots after this timestamp
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
  }
}

// ── Spacing ────────────────────────────────────────────────────────────

/**
 * Check if a candidate timeslot respects idea spacing constraints.
 * Same idea, same platform → must be samePlatformMs apart.
 * Same idea, different platform → must be crossPlatformMs apart.
 */
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

/**
 * Build spacing references from already-scheduled posts sharing the same idea IDs.
 */
async function getIdeaReferences(
  ideaIds: string[],
  allBookedSlots: readonly BookedSlot[],
): Promise<IdeaRef[]> {
  const sameIdeaPosts = await getScheduledItemsByIdeaIds(ideaIds)

  const lateSlotsByPostId = new Map<string, BookedSlot[]>()
  const localSlotsByItemId = new Map<string, BookedSlot[]>()
  for (const slot of allBookedSlots) {
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

// ── Main API ───────────────────────────────────────────────────────────

/**
 * Find the next available posting slot for a platform.
 *
 * Single walk-through algorithm:
 * 1. Generate timeslots chronologically (from now, or from publishBy deadline backwards)
 * 2. For each slot, check idea spacing — skip if too close to same-idea posts
 * 3. If empty → take it
 * 4. If taken by a non-idea Late post → call findNextSlot for that post to
 *    reschedule it, then take its slot
 * 5. If taken by an idea post or displacement disabled → skip
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
  const displacementEnabled = getDisplacementConfig().enabled

  // Resolve publishBy as an upper bound on the search
  let maxMs: number | undefined
  if (options?.publishBy) {
    const publishByMs = normalizeDateTime(options.publishBy)
    if (Number.isNaN(publishByMs)) {
      logger.warn(`Invalid publishBy "${sanitizeLogValue(options.publishBy)}"; ignoring`)
    } else if (publishByMs <= nowMs) {
      logger.warn(`publishBy "${sanitizeLogValue(options.publishBy)}" has already passed; scheduling normally`)
    } else {
      maxMs = publishByMs
      const daysUntil = (publishByMs - nowMs) / DAY_MS
      if (daysUntil < 3) {
        logger.debug(`Urgent publishBy "${sanitizeLogValue(options.publishBy)}"`)
      }
    }
  }

  // Step 1: Get what's booked on this platform
  const bookedSlots = await buildBookedSlots(platform)
  const bookedMap = new Map<number, BookedSlot>()
  for (const slot of bookedSlots) {
    bookedMap.set(normalizeDateTime(slot.scheduledFor), slot)
  }
  const bookedMs = new Set(bookedMap.keys())

  // Step 2: If idea-aware, get idea-linked post IDs and spacing references
  let ideaLinkedPostIds = new Set<string>()
  let ideaRefs: IdeaRef[] = []
  let samePlatformMs = 0
  let crossPlatformMs = 0

  if (isIdeaAware) {
    const allBookedSlots = await buildBookedSlots()
    const [linkedIds, refs] = await Promise.all([
      getIdeaLinkedLatePostIds(),
      getIdeaReferences(ideaIds, allBookedSlots),
    ])
    ideaLinkedPostIds = linkedIds
    ideaRefs = refs

    const spacingConfig = getIdeaSpacingConfig()
    samePlatformMs = spacingConfig.samePlatformHours * HOUR_MS
    crossPlatformMs = spacingConfig.crossPlatformHours * HOUR_MS
  }

  // Step 3: Walk through timeslots chronologically
  const lateClient = new LateApiClient()

  for (const { datetime, ms } of generateTimeslots(platformConfig, timezone, nowMs, maxMs)) {
    // Check idea spacing — skip slots too close to same-idea posts
    if (isIdeaAware && !passesIdeaSpacing(ms, platform, ideaRefs, samePlatformMs, crossPlatformMs)) {
      continue
    }

    const booked = bookedMap.get(ms)

    if (!booked) {
      // Empty slot → take it
      return datetime
    }

    // Slot is taken — try to displace if idea-aware
    if (!isIdeaAware || !displacementEnabled) continue
    if (booked.source !== 'late' || !booked.postId) continue
    if (ideaLinkedPostIds.has(booked.postId)) continue

    // Non-idea Late post — use the same scheduling logic to find it a new home
    const newSlot = findNextEmptySlot(platformConfig, timezone, ms, bookedMs)
    if (newSlot) {
      await lateClient.schedulePost(booked.postId, newSlot)
      logger.info(
        `Displaced post ${sanitizeLogValue(booked.postId)} from ${sanitizeLogValue(datetime)} ` +
        `to ${sanitizeLogValue(newSlot)} for idea-linked content`,
      )
      return datetime
    }
  }

  logger.warn(`No available slot found for "${sanitizeLogValue(platform)}" within ${MAX_LOOKAHEAD_DAYS} days`)
  return null
}

/**
 * Find the next empty timeslot after a given timestamp.
 * Uses the same timeslot generation as findNextSlot.
 */
function findNextEmptySlot(
  platformConfig: PlatformSchedule,
  timezone: string,
  afterMs: number,
  bookedMs: ReadonlySet<number>,
): string | null {
  for (const { datetime, ms } of generateTimeslots(platformConfig, timezone, afterMs)) {
    if (!bookedMs.has(ms)) return datetime
  }
  return null
}

/**
 * Find next empty slot excluding both booked AND already-assigned slots.
 */
function findNextEmptySlotExcluding(
  platformConfig: PlatformSchedule,
  timezone: string,
  afterMs: number,
  bookedMs: ReadonlySet<number>,
  assignedMs: ReadonlySet<number>,
): Timeslot | null {
  for (const slot of generateTimeslots(platformConfig, timezone, afterMs)) {
    if (!bookedMs.has(slot.ms) && !assignedMs.has(slot.ms)) return slot
  }
  return null
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
 * Reschedule all idea-linked posts through the current scheduling logic.
 * Idea posts get priority — non-idea posts in their way get displaced.
 * Existing Late posts are updated in-place (not re-uploaded).
 */
export async function rescheduleIdeaPosts(options?: { dryRun?: boolean }): Promise<RescheduleResult> {
  const dryRun = options?.dryRun ?? false
  const { updatePublishedItemSchedule } = await import('../postStore/postStore.js')
  const config = await loadScheduleConfig()
  const { timezone } = config
  const displacementEnabled = getDisplacementConfig().enabled
  const nowMs = Date.now()

  // Step 1: Get all published items with idea IDs
  const publishedItems = await getPublishedItems()
  const ideaPosts = publishedItems.filter(
    (item) => item.metadata.ideaIds?.length && item.metadata.latePostId,
  )

  if (ideaPosts.length === 0) {
    logger.info('No idea-linked posts to reschedule')
    return { rescheduled: 0, unchanged: 0, failed: 0, details: [] }
  }

  logger.info(`Found ${ideaPosts.length} idea-linked posts to reschedule`)

  // Step 2: Build booked slot map per platform, EXCLUDING idea-linked posts
  const ideaLatePostIds = new Set(ideaPosts.map((item) => item.metadata.latePostId!))
  const allBookedSlots = await buildBookedSlots()
  const nonIdeaSlotsByPlatform = new Map<string, Map<number, BookedSlot>>()
  const nonIdeaBookedMsByPlatform = new Map<string, Set<number>>()

  for (const slot of allBookedSlots) {
    // Skip idea-linked posts — they'll be reassigned
    if (slot.postId && ideaLatePostIds.has(slot.postId)) continue

    if (!nonIdeaSlotsByPlatform.has(slot.platform)) {
      nonIdeaSlotsByPlatform.set(slot.platform, new Map())
      nonIdeaBookedMsByPlatform.set(slot.platform, new Set())
    }
    const ms = normalizeDateTime(slot.scheduledFor)
    nonIdeaSlotsByPlatform.get(slot.platform)!.set(ms, slot)
    nonIdeaBookedMsByPlatform.get(slot.platform)!.add(ms)
  }

  // Step 3: Sort idea posts — earliest-created ideas first
  ideaPosts.sort((a, b) => a.metadata.createdAt.localeCompare(b.metadata.createdAt))

  // Step 4: Walk through and assign each idea post
  const lateClient = new LateApiClient()
  const result: RescheduleResult = { rescheduled: 0, unchanged: 0, failed: 0, details: [] }
  // Track newly assigned slots to prevent double-booking between idea posts
  const assignedSlots = new Map<string, Set<number>>() // platform → set of ms

  for (const item of ideaPosts) {
    const platform = item.metadata.platform
    const clipType = item.metadata.clipType
    const latePostId = item.metadata.latePostId!
    const oldSlot = item.metadata.scheduledFor

    try {
      const platformConfig = getPlatformSchedule(platform, clipType)
      if (!platformConfig) {
        result.details.push({ itemId: item.id, platform, latePostId, oldSlot, newSlot: null, error: 'No schedule config' })
        result.failed++
        continue
      }

      const bookedMap = nonIdeaSlotsByPlatform.get(platform) ?? new Map<number, BookedSlot>()
      const bookedMs = nonIdeaBookedMsByPlatform.get(platform) ?? new Set<number>()
      const assigned = assignedSlots.get(platform) ?? new Set<number>()

      let newSlotDatetime: string | null = null

      for (const { datetime, ms } of generateTimeslots(platformConfig, timezone, nowMs)) {
        // Skip slots already assigned to other idea posts in this batch
        if (assigned.has(ms)) continue

        const booked = bookedMap.get(ms)

        if (!booked) {
          // Empty slot — take it
          newSlotDatetime = datetime
          break
        }

        // Slot taken by non-idea post — displace it
        if (displacementEnabled && booked.source === 'late' && booked.postId) {
          const nextEmpty = findNextEmptySlotExcluding(platformConfig, timezone, ms, bookedMs, assigned)
          if (nextEmpty) {
            if (!dryRun) {
              await lateClient.schedulePost(booked.postId, nextEmpty.datetime)
            }
            // Update booked maps
            bookedMap.delete(ms)
            bookedMs.delete(ms)
            bookedMap.set(nextEmpty.ms, { ...booked, scheduledFor: nextEmpty.datetime })
            bookedMs.add(nextEmpty.ms)
            logger.info(`Displaced post ${booked.postId} from ${datetime} to ${nextEmpty.datetime}`)

            newSlotDatetime = datetime
            break
          }
        }
      }

      if (!newSlotDatetime) {
        result.details.push({ itemId: item.id, platform, latePostId, oldSlot, newSlot: null, error: 'No slot found' })
        result.failed++
        continue
      }

      const newSlotMs = normalizeDateTime(newSlotDatetime)
      assigned.add(newSlotMs)
      assignedSlots.set(platform, assigned)

      if (oldSlot && normalizeDateTime(oldSlot) === newSlotMs) {
        result.details.push({ itemId: item.id, platform, latePostId, oldSlot, newSlot: newSlotDatetime })
        result.unchanged++
        continue
      }

      // Reschedule existing Late post (update, not re-upload)
      if (!dryRun) {
        await lateClient.schedulePost(latePostId, newSlotDatetime)
        await updatePublishedItemSchedule(item.id, newSlotDatetime)
      }
      logger.info(
        `Rescheduled idea post ${item.id} (${platform}) from ${oldSlot ?? 'unscheduled'} to ${newSlotDatetime}`,
      )

      result.details.push({ itemId: item.id, platform, latePostId, oldSlot, newSlot: newSlotDatetime })
      result.rescheduled++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`Failed to reschedule ${item.id}: ${msg}`)
      result.details.push({ itemId: item.id, platform, latePostId, oldSlot, newSlot: null, error: msg })
      result.failed++
    }
  }

  logger.info(
    `Reschedule complete: ${result.rescheduled} moved, ${result.unchanged} unchanged, ${result.failed} failed`,
  )
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
  const slots = await buildBookedSlots()

  let filtered = slots
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
