import { LateApiClient, type LatePost } from './lateApi'
import { loadScheduleConfig, type DayOfWeek } from './scheduleConfig'
import { getPublishedItems } from './postStore'
import logger, { sanitizeForLog } from '../config/logger'

/**
 * Normalize ISO datetime to milliseconds since epoch for collision detection.
 * Handles different ISO formats from Late API vs local queue.
 */
function normalizeDateTime(isoString: string): number {
  return new Date(isoString).getTime()
}

const CHUNK_DAYS = 14        // generate candidates in 14-day chunks
const MAX_LOOKAHEAD_DAYS = 730  // hard ceiling (~2 years)

interface BookedSlot {
  scheduledFor: string
  source: 'late' | 'local'
  postId?: string
  itemId?: string
  platform: string
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
  const tzPart = parts.find(p => p.type === 'timeZoneName')
  // longOffset gives e.g. "GMT-06:00" or "GMT+05:30"
  const match = tzPart?.value?.match(/GMT([+-]\d{2}:\d{2})/)
  if (match) return match[1]
  // GMT with no offset means UTC
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
  // Derive calendar date parts in the target timezone to avoid host-timezone skew
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const yearPart = parts.find(p => p.type === 'year')?.value
  const monthPart = parts.find(p => p.type === 'month')?.value
  const dayPart = parts.find(p => p.type === 'day')?.value

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
    sun: 'sun', mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat',
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
    for (const p of post.platforms) {
      if (!platform || p.platform === platform) {
        slots.push({
          scheduledFor: post.scheduledFor,
          source: 'late',
          postId: post._id,
          platform: p.platform,
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
 * Find the next available posting slot for a platform.
 *
 * Algorithm (generate-sort-filter):
 * 1. Load platform schedule config from schedule.json
 * 2. Build set of already-booked datetimes from Late API + local published items
 * 3. In 14-day chunks, generate candidate slot datetimes, sort, and check availability
 * 4. If no available slot in the current chunk, expand to the next chunk (up to ~2 years)
 * 5. Return the first candidate not already booked, or null if none found
 */
export async function findNextSlot(platform: string): Promise<string | null> {
  const config = await loadScheduleConfig()
  const platformConfig = config.platforms[platform]
  if (!platformConfig) {
    logger.warn(`No schedule config found for platform "${platform}"`)
    return null
  }

  const { timezone } = config
  const bookedSlots = await buildBookedSlots(platform)
  const bookedDatetimes = new Set(bookedSlots.map(s => normalizeDateTime(s.scheduledFor)))

  const now = new Date()
  let startOffset = 1

  while (startOffset <= MAX_LOOKAHEAD_DAYS) {
    const endOffset = Math.min(startOffset + CHUNK_DAYS - 1, MAX_LOOKAHEAD_DAYS)
    const candidates: string[] = []

    for (let dayOffset = startOffset; dayOffset <= endOffset; dayOffset++) {
      const candidateDate = new Date(now)
      candidateDate.setDate(candidateDate.getDate() + dayOffset)

      const dayOfWeek = getDayOfWeekInTimezone(candidateDate, timezone)
      if (platformConfig.avoidDays.includes(dayOfWeek)) continue

      for (const slot of platformConfig.slots) {
        if (!slot.days.includes(dayOfWeek)) continue
        candidates.push(buildSlotDatetime(candidateDate, slot.time, timezone))
      }
    }

    candidates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())

    const available = candidates.find(c => !bookedDatetimes.has(normalizeDateTime(c)))
    if (available) {
      logger.debug(`Found available slot for ${sanitizeForLog(platform)}: ${sanitizeForLog(available)}`)
      return available
    }

    startOffset = endOffset + 1
  }

  logger.warn(`No available slot found for "${sanitizeForLog(platform)}" within ${MAX_LOOKAHEAD_DAYS} days`)
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

  let filtered = slots.map(s => ({
    platform: s.platform,
    scheduledFor: s.scheduledFor,
    source: s.source,
    postId: s.postId,
    itemId: s.itemId,
  }))

  if (startDate) {
    const startMs = startDate.getTime()
    filtered = filtered.filter(s => new Date(s.scheduledFor).getTime() >= startMs)
  }
  if (endDate) {
    const endMs = endDate.getTime()
    filtered = filtered.filter(s => new Date(s.scheduledFor).getTime() <= endMs)
  }

  filtered.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
  return filtered
}
