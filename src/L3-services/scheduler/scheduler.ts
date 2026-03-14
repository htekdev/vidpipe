import { LateApiClient, type LatePost } from '../../L2-clients/late/lateApi.js'
import logger from '../../L1-infra/logger/configLogger.js'
import {
  getPublishedItemByLatePostId,
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

/**
 * Normalize ISO datetime to milliseconds since epoch for collision detection.
 * Handles different ISO formats from Late API vs local queue.
 */
function normalizeDateTime(isoString: string): number {
  return new Date(isoString).getTime()
}

const CHUNK_DAYS = 14
const MAX_LOOKAHEAD_DAYS = 730
const DEFAULT_IDEA_WINDOW_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

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

type CandidateGuard = (candidateMs: number, candidatePlatform: string) => boolean

interface IdeaReference {
  platform: string
  scheduledFor: string
}

interface SearchWindow {
  emptyWindowEndMs?: number
  displacementWindowEndMs?: number
}

interface FindEmptySlotParams {
  platformConfig: PlatformSchedule
  timezone: string
  bookedDatetimes: ReadonlySet<number>
  platform: string
  searchFromMs: number
  includeSearchDay?: boolean
  maxCandidateMs?: number
  passesCandidate?: CandidateGuard
}

interface TryDisplacementParams {
  bookedSlots: readonly BookedSlot[]
  platform: string
  platformConfig: PlatformSchedule
  timezone: string
  bookedDatetimes: Set<number>
  options: SlotOptions
  nowMs: number
  maxCandidateMs?: number
  passesSpacing?: CandidateGuard
}

function sanitizeLogValue(value: string): string {
  return value.replace(/[\r\n]/g, '')
}

/**
 * Get the UTC offset string (e.g. "-06:00") for a timezone on a given date.
 */
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

/**
 * Build an ISO datetime string with timezone offset for a given date and time.
 */
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

/**
 * Get the day-of-week key for a Date in the given timezone.
 */
function getDayOfWeekInTimezone(date: Date, timezone: string): DayOfWeek {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  })
  const short = formatter.format(date).toLowerCase().slice(0, 3)
  const map: Record<string, DayOfWeek> = {
    sun: 'sun',
    mon: 'mon',
    tue: 'tue',
    wed: 'wed',
    thu: 'thu',
    fri: 'fri',
    sat: 'sat',
  }
  return map[short] ?? 'mon'
}

/**
 * Fetch scheduled posts from Late API, returning empty array on failure.
 */
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
 * Build the set of already-booked slots from Late API and local published items.
 */
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

function buildIdeaReferences(
  sameIdeaPosts: readonly QueueItem[],
  allBookedSlots: readonly BookedSlot[],
): IdeaReference[] {
  const lateSlotsByPostId = new Map<string, BookedSlot[]>()
  const localSlotsByItemId = new Map<string, BookedSlot[]>()

  for (const slot of allBookedSlots) {
    if (slot.postId) {
      const slots = lateSlotsByPostId.get(slot.postId) ?? []
      slots.push(slot)
      lateSlotsByPostId.set(slot.postId, slots)
    }
    if (slot.itemId) {
      const slots = localSlotsByItemId.get(slot.itemId) ?? []
      slots.push(slot)
      localSlotsByItemId.set(slot.itemId, slots)
    }
  }

  const references: IdeaReference[] = []
  const seen = new Set<string>()
  const addReference = (platformName: string, scheduledFor: string | null | undefined): void => {
    if (!scheduledFor) return
    const key = `${platformName}@${scheduledFor}`
    if (seen.has(key)) return
    seen.add(key)
    references.push({ platform: platformName, scheduledFor })
  }

  for (const item of sameIdeaPosts) {
    addReference(item.metadata.platform, item.metadata.scheduledFor)

    if (item.metadata.latePostId) {
      for (const slot of lateSlotsByPostId.get(item.metadata.latePostId) ?? []) {
        addReference(slot.platform, slot.scheduledFor)
      }
    }

    for (const slot of localSlotsByItemId.get(item.id) ?? []) {
      addReference(slot.platform, slot.scheduledFor)
    }
  }

  return references
}

function createSpacingGuard(
  ideaReferences: readonly IdeaReference[],
  samePlatformHours: number,
  crossPlatformHours: number,
): CandidateGuard {
  const samePlatformWindowMs = samePlatformHours * HOUR_MS
  const crossPlatformWindowMs = crossPlatformHours * HOUR_MS

  return (candidateMs: number, candidatePlatform: string): boolean => {
    for (const reference of ideaReferences) {
      const referenceMs = normalizeDateTime(reference.scheduledFor)
      const diff = Math.abs(candidateMs - referenceMs)

      if (reference.platform === candidatePlatform && diff < samePlatformWindowMs) {
        return false
      }
      if (diff < crossPlatformWindowMs) {
        return false
      }
    }

    return true
  }
}

function resolveSearchWindow(nowMs: number, options?: SlotOptions): SearchWindow {
  const defaultWindowEndMs = nowMs + DEFAULT_IDEA_WINDOW_DAYS * DAY_MS
  const publishBy = options?.publishBy

  if (!publishBy) {
    return {
      emptyWindowEndMs: defaultWindowEndMs,
      displacementWindowEndMs: defaultWindowEndMs,
    }
  }

  const publishByMs = normalizeDateTime(publishBy)
  if (Number.isNaN(publishByMs)) {
    logger.warn(`Invalid publishBy "${sanitizeLogValue(publishBy)}" provided; scheduling normally without urgency bias`)
    return {}
  }

  const daysUntilPublishBy = (publishByMs - nowMs) / DAY_MS
  if (daysUntilPublishBy <= 0) {
    logger.warn(`publishBy "${sanitizeLogValue(publishBy)}" has already passed; scheduling normally without urgency bias`)
    return {}
  }

  if (daysUntilPublishBy < 3) {
    logger.debug(`Urgent publishBy "${sanitizeLogValue(publishBy)}"; prioritizing earliest displaceable slot`)
  }

  return {
    emptyWindowEndMs: publishByMs,
    displacementWindowEndMs:
      daysUntilPublishBy < 7
        ? Math.min(publishByMs, nowMs + 3 * DAY_MS)
        : publishByMs,
  }
}

function findEmptySlot({
  platformConfig,
  timezone,
  bookedDatetimes,
  platform,
  searchFromMs,
  includeSearchDay = false,
  maxCandidateMs,
  passesCandidate,
}: FindEmptySlotParams): string | null {
  if (maxCandidateMs !== undefined && maxCandidateMs < searchFromMs) {
    return null
  }

  const baseDate = new Date(searchFromMs)
  const initialOffset = includeSearchDay ? 0 : 1
  let maxDayOffset = MAX_LOOKAHEAD_DAYS

  if (maxCandidateMs !== undefined) {
    maxDayOffset = Math.min(
      MAX_LOOKAHEAD_DAYS,
      Math.max(initialOffset, Math.ceil((maxCandidateMs - searchFromMs) / DAY_MS)),
    )
  }

  let startOffset = initialOffset
  while (startOffset <= maxDayOffset) {
    const endOffset = Math.min(startOffset + CHUNK_DAYS - 1, maxDayOffset)
    const candidates: string[] = []

    for (let dayOffset = startOffset; dayOffset <= endOffset; dayOffset++) {
      const candidateDate = new Date(baseDate)
      candidateDate.setDate(candidateDate.getDate() + dayOffset)

      const dayOfWeek = getDayOfWeekInTimezone(candidateDate, timezone)
      if (platformConfig.avoidDays.includes(dayOfWeek)) continue

      for (const slot of platformConfig.slots) {
        if (!slot.days.includes(dayOfWeek)) continue

        const candidate = buildSlotDatetime(candidateDate, slot.time, timezone)
        const candidateMs = normalizeDateTime(candidate)
        if (candidateMs <= searchFromMs) continue
        if (maxCandidateMs !== undefined && candidateMs > maxCandidateMs) continue
        if (bookedDatetimes.has(candidateMs)) continue
        if (passesCandidate && !passesCandidate(candidateMs, platform)) continue

        candidates.push(candidate)
      }
    }

    candidates.sort((left, right) => normalizeDateTime(left) - normalizeDateTime(right))
    if (candidates.length > 0) {
      return candidates[0]
    }

    startOffset = endOffset + 1
  }

  return null
}

async function tryDisplacement({
  bookedSlots,
  platform,
  platformConfig,
  timezone,
  bookedDatetimes,
  options,
  nowMs,
  maxCandidateMs,
  passesSpacing,
}: TryDisplacementParams): Promise<SlotResult | null> {
  const displacementConfig = getDisplacementConfig()
  if (!displacementConfig.enabled || !options.ideaIds?.length) {
    return null
  }

  const candidateSlots = bookedSlots
    .filter((slot) => {
      const slotMs = normalizeDateTime(slot.scheduledFor)
      if (slotMs <= nowMs) return false
      if (maxCandidateMs !== undefined && slotMs > maxCandidateMs) return false
      return true
    })
    .sort((left, right) => normalizeDateTime(left.scheduledFor) - normalizeDateTime(right.scheduledFor))

  const lateClient = new LateApiClient()
  const publishedItemCache = new Map<string, QueueItem | null>()

  for (const slot of candidateSlots) {
    if (slot.source !== 'late' || !slot.postId) continue

    const candidateMs = normalizeDateTime(slot.scheduledFor)
    if (passesSpacing && !passesSpacing(candidateMs, platform)) continue

    let publishedItem = publishedItemCache.get(slot.postId)
    if (publishedItem === undefined) {
      publishedItem = await getPublishedItemByLatePostId(slot.postId)
      publishedItemCache.set(slot.postId, publishedItem)
    }

    if (!publishedItem) {
      continue
    }

    if (publishedItem.metadata.ideaIds?.length) {
      continue
    }

    const displacedPlatformConfig = publishedItem?.metadata.clipType
      ? getPlatformSchedule(platform, publishedItem.metadata.clipType) ?? platformConfig
      : platformConfig

    const newSlot = findEmptySlot({
      platformConfig: displacedPlatformConfig,
      timezone,
      bookedDatetimes,
      platform,
      searchFromMs: candidateMs,
      includeSearchDay: true,
    })

    if (!newSlot) continue

    await lateClient.schedulePost(slot.postId, newSlot)
    logger.info(
      `Displaced post ${sanitizeLogValue(slot.postId)} from ${sanitizeLogValue(slot.scheduledFor)} ` +
      `to ${sanitizeLogValue(newSlot)} for idea-linked content`,
    )

    return {
      slot: slot.scheduledFor,
      displaced: {
        postId: slot.postId,
        originalSlot: slot.scheduledFor,
        newSlot,
      },
    }
  }

  return null
}

/**
 * Find the next available posting slot for a platform.
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

  const ideaIds = options?.ideaIds?.filter(Boolean) ?? []
  const isIdeaAware = ideaIds.length > 0
  const nowMs = Date.now()
  const { timezone } = config

  const [allBookedSlots, sameIdeaPosts] = await Promise.all([
    isIdeaAware ? buildBookedSlots() : Promise.resolve([] as BookedSlot[]),
    isIdeaAware ? getScheduledItemsByIdeaIds(ideaIds) : Promise.resolve([] as QueueItem[]),
  ])

  const bookedSlots = isIdeaAware
    ? allBookedSlots.filter((slot) => slot.platform === platform)
    : await buildBookedSlots(platform)
  const bookedDatetimes = new Set(bookedSlots.map((slot) => normalizeDateTime(slot.scheduledFor)))

  const spacingConfig = isIdeaAware ? getIdeaSpacingConfig() : null
  const spacingGuard = spacingConfig
    ? createSpacingGuard(
      buildIdeaReferences(sameIdeaPosts, allBookedSlots),
      spacingConfig.samePlatformHours,
      spacingConfig.crossPlatformHours,
    )
    : undefined

  const searchWindow = isIdeaAware ? resolveSearchWindow(nowMs, options) : {}
  const emptySlot = findEmptySlot({
    platformConfig,
    timezone,
    bookedDatetimes,
    platform,
    searchFromMs: nowMs,
    maxCandidateMs: searchWindow.emptyWindowEndMs,
    passesCandidate: spacingGuard,
  })

  if (emptySlot) {
    logger.debug(`Found available slot for ${sanitizeLogValue(platform)}: ${sanitizeLogValue(emptySlot)}`)
    return emptySlot
  }

  if (isIdeaAware) {
    const displaced = await tryDisplacement({
      bookedSlots,
      platform,
      platformConfig,
      timezone,
      bookedDatetimes,
      options: { ...options, ideaIds },
      nowMs,
      maxCandidateMs: searchWindow.displacementWindowEndMs,
      passesSpacing: spacingGuard,
    })
    if (displaced) {
      return displaced.slot
    }
  }

  logger.warn(`No available slot found for "${sanitizeLogValue(platform)}" within ${MAX_LOOKAHEAD_DAYS} days`)
  return null
}

/**
 * Get a calendar view of scheduled posts across all platforms.
 * Returns slots sorted by datetime.
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
