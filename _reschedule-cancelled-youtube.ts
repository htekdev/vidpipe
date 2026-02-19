import 'dotenv/config'
import { readFileSync } from 'node:fs'

const API = 'https://getlate.dev/api/v1'
const KEY = process.env.LATE_API_KEY!
const headers: Record<string, string> = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const TZ = 'America/Chicago'

interface LatePost {
  _id: string
  content: string
  status: string
  platforms: Array<{ platform: string; accountId: string }>
  scheduledFor?: string
  mediaItems?: Array<{ type: string; url: string }>
  tags?: string[]
  hashtags?: string[]
  platformSpecificData?: Record<string, unknown>
}

// ── Fetch helpers ──

async function fetchPosts(status: string): Promise<LatePost[]> {
  const res = await fetch(`${API}/posts?status=${status}&platform=youtube&limit=100`, { headers })
  if (!res.ok) throw new Error(`Failed to fetch ${status} posts: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { posts?: LatePost[]; data?: LatePost[] }
  return data.posts ?? data.data ?? []
}

// ── Slot computation ──

function getYoutubeSlotTimes(): string[] {
  const schedule = JSON.parse(readFileSync('schedule.json', 'utf8'))
  const slots = schedule.platforms.youtube.byClipType.short.slots as Array<{ time: string }>
  return slots.map(s => s.time).sort()
}

function toChicagoISO(date: Date, time: string): string {
  // Build an ISO string in America/Chicago timezone
  const [hh, mm] = time.split(':')
  const d = new Date(date)
  d.setHours(parseInt(hh), parseInt(mm), 0, 0)
  // Format as ISO with Chicago offset
  const iso = d.toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T')
  // Get the UTC offset for this datetime in Chicago
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))
  const chi = new Date(d.toLocaleString('en-US', { timeZone: TZ }))
  const offsetMs = utc.getTime() - chi.getTime()
  const offsetH = Math.floor(Math.abs(offsetMs) / 3600000)
  const offsetM = Math.floor((Math.abs(offsetMs) % 3600000) / 60000)
  const sign = offsetMs >= 0 ? '+' : '-'
  return `${iso}${sign}${String(offsetH).padStart(2, '0')}:${String(offsetM).padStart(2, '0')}`
}

function generateAvailableSlots(count: number, bookedSet: Set<string>): string[] {
  const slotTimes = getYoutubeSlotTimes()
  const available: string[] = []
  const now = new Date()

  // Start from tomorrow
  const start = new Date(now.toLocaleString('en-US', { timeZone: TZ }))
  start.setDate(start.getDate() + 1)
  start.setHours(0, 0, 0, 0)

  for (let dayOffset = 0; dayOffset < 60 && available.length < count; dayOffset++) {
    const day = new Date(start)
    day.setDate(day.getDate() + dayOffset)

    for (const time of slotTimes) {
      if (available.length >= count) break
      const isoSlot = toChicagoISO(day, time)
      // Check if slot is already booked (compare by minute precision)
      const slotKey = isoSlot.slice(0, 16) // YYYY-MM-DDTHH:MM
      if (!bookedSet.has(slotKey)) {
        available.push(isoSlot)
        bookedSet.add(slotKey) // Mark as taken for subsequent posts
      }
    }
  }
  return available
}

// ── Actions ──

async function createPost(post: LatePost, scheduledFor: string): Promise<{ _id: string; scheduledFor: string }> {
  // Flatten accountId from nested object to string ID
  const platforms = post.platforms.map(p => ({
    platform: p.platform,
    accountId: typeof p.accountId === 'string' ? p.accountId : (p.accountId as any)._id,
  }))
  const body = {
    content: post.content,
    platforms,
    scheduledFor,
    mediaItems: post.mediaItems?.map(m => ({ type: m.type, url: m.url })),
    tags: post.tags,
    hashtags: post.hashtags,
  }
  const res = await fetch(`${API}/posts`, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Failed to create post: ${res.status} ${await res.text()}`)
  return (await res.json()) as { _id: string; scheduledFor: string }
}

async function deletePost(postId: string): Promise<void> {
  const res = await fetch(`${API}/posts/${postId}`, { method: 'DELETE', headers })
  if (!res.ok) console.warn(`  ⚠ Could not delete old post ${postId}: ${res.status}`)
}

// ── Main ──

async function main() {
  console.log('🔍 Fetching cancelled YouTube posts...')
  const cancelled = await fetchPosts('cancelled')

  if (cancelled.length === 0) {
    console.log('✅ No cancelled YouTube posts found.')
    return
  }

  console.log(`📋 Found ${cancelled.length} cancelled YouTube post(s)`)

  // Fetch currently scheduled posts to avoid double-booking
  console.log('📅 Fetching existing scheduled posts...')
  const scheduled = await fetchPosts('scheduled')
  const bookedSet = new Set<string>()
  for (const p of scheduled) {
    if (p.scheduledFor) {
      // Normalize to YYYY-MM-DDTHH:MM for comparison
      const d = new Date(p.scheduledFor)
      const local = d.toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T')
      bookedSet.add(local.slice(0, 16))
    }
  }
  console.log(`  ${scheduled.length} existing scheduled post(s), ${bookedSet.size} unique slot(s) booked`)

  // Generate available slots
  console.log('📅 Computing available slots...')
  const slots = generateAvailableSlots(cancelled.length, bookedSet)
  console.log(`  Found ${slots.length} available slot(s)\n`)

  if (slots.length < cancelled.length) {
    console.warn(`⚠ Only found ${slots.length} slots for ${cancelled.length} posts\n`)
  }

  // Show plan
  const pairs = cancelled.slice(0, slots.length).map((p, i) => ({ post: p, newTime: slots[i] }))
  console.log('📋 Proposed reschedule:\n')
  for (const { post, newTime } of pairs) {
    const preview = post.content.slice(0, 70).replace(/\n/g, ' ')
    console.log(`  "${preview}..."`)
    console.log(`    Old: ${post.scheduledFor ?? 'N/A'} → New: ${newTime}\n`)
  }

  // Execute
  console.log('🚀 Rescheduling...\n')
  let success = 0
  let failed = 0
  for (const { post, newTime } of pairs) {
    try {
      const created = await createPost(post, newTime)
      await deletePost(post._id)
      console.log(`  ✅ ${post._id} → ${created._id} at ${newTime}`)
      success++
      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 500))
    } catch (err) {
      console.error(`  ❌ ${post._id}: ${(err as Error).message}`)
      failed++
    }
  }

  console.log(`\n✅ Done! ${success} rescheduled, ${failed} failed.`)
}

main().catch(console.error)
