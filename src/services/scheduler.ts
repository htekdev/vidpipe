import { LateApiClient, type LatePost } from './lateApi'
import { loadScheduleConfig, type PlatformSchedule, type DayOfWeek } from './scheduleConfig'
import { getPublishedItems, type QueueItem } from './postStore'
import logger from '../config/logger'

const DAY_MAP: Record<DayOfWeek, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

const MAX_LOOKAHEAD_DAYS = 14

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
  return '+00:00'
}

/**
 * Build an ISO datetime string with timezone offset for a given date and time.
 */
function buildSlotDatetime(date: Date, time: string, timezone: string): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
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
 * Get date components in the target timezone.
 */
function getDateInTimezone(date: Date, timezone: string): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  return {
    year: Number(parts.find(p => p.type === 'year')!.value),
    month: Number(parts.find(p => p.type === 'month')!.value),
    day: Number(parts.find(p => p.type === 'day')!.value),
  }
}

/**
 * Check if two dates are the same calendar day in the given timezone.
 */
function isSameDayInTimezone(a: Date, b: Date, timezone: string): boolean {
  const aDate = getDateInTimezone(a, timezone)
  const bDate = getDateInTimezone(b, timezone)
  return aDate.year === bDate.year && aDate.month === bDate.month && aDate.day === bDate.day
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
 * Count how many posts are scheduled for a given platform on a given date.
 */
function countPostsOnDate(
  date: Date,
  platform: string,
  bookedSlots: Array<{ scheduledFor: string; platform?: string }>,
): number {
  // Load timezone synchronously from the module-level — callers ensure config is loaded
  let count = 0
  for (const slot of bookedSlots) {
    if (slot.platform && slot.platform !== platform) continue
    const slotDate = new Date(slot.scheduledFor)
    if (isNaN(slotDate.getTime())) continue
    // Compare calendar dates (using UTC date components from the ISO string)
    if (
      slotDate.getUTCFullYear() === date.getUTCFullYear() &&
      slotDate.getUTCMonth() === date.getUTCMonth() &&
      slotDate.getUTCDate() === date.getUTCDate()
    ) {
      count++
    }
  }
  return count
}

/**
 * Find the next available posting slot for a platform.
 *
 * Algorithm:
 * 1. Load platform schedule config from schedule.json
 * 2. Query Late API for existing scheduled posts for this platform
 * 3. Get locally published items for this platform (from published/ folder)
 * 4. Build set of already-booked slots
 * 5. Starting from tomorrow, iterate through configured days/times:
 *    a. Skip if day not in slot.days
 *    b. Skip if day is in avoidDays
 *    c. Skip if day already has maxPerDay posts scheduled
 *    d. Skip if this exact datetime is already booked
 *    e. Return first available slot as ISO datetime string
 * 6. If no slot found within 14 days, return null with warning
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

  // Build a set of booked datetime strings for quick lookup
  const bookedDatetimes = new Set(bookedSlots.map(s => s.scheduledFor))

  const now = new Date()

  for (let dayOffset = 1; dayOffset <= MAX_LOOKAHEAD_DAYS; dayOffset++) {
    const candidateDate = new Date(now)
    candidateDate.setDate(candidateDate.getDate() + dayOffset)

    const dayOfWeek = getDayOfWeekInTimezone(candidateDate, timezone)

    // Skip avoid days
    if (platformConfig.avoidDays.includes(dayOfWeek)) continue

    // Collect all candidate times for this day, sorted chronologically
    const candidateTimes: string[] = []
    for (const slot of platformConfig.slots) {
      if (!slot.days.includes(dayOfWeek)) continue
      candidateTimes.push(slot.time)
    }
    candidateTimes.sort()

    if (candidateTimes.length === 0) continue

    // Check maxPerDay
    const { year, month, day } = getDateInTimezone(candidateDate, timezone)
    // Build a reference date for counting — use noon to avoid DST edge cases
    const refDate = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00Z`)
    const postsOnDay = countPostsOnDate(refDate, platform, bookedSlots)
    if (postsOnDay >= platformConfig.maxPerDay) continue

    for (const time of candidateTimes) {
      const slotDatetime = buildSlotDatetime(candidateDate, time, timezone)
      if (!bookedDatetimes.has(slotDatetime)) {
        logger.debug(`Found available slot for ${platform}: ${slotDatetime}`)
        return slotDatetime
      }
    }
  }

  logger.warn(`No available slot found for "${platform}" within ${MAX_LOOKAHEAD_DAYS} days`)
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

  filtered.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
  return filtered
}
