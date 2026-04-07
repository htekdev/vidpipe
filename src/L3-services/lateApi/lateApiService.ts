/**
 * L3 service wrapper for the Late API client.
 *
 * Wraps the L2 LateApiClient constructor so that L7 (and higher layers)
 * can access Late functionality without importing L2 directly.
 */
import { LateApiClient as _LateApiClient } from '../../L2-clients/late/lateApi.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { getQueueId, getProfileId } from '../queueMapping/queueMapping.js'

export function createLateApiClient(
  ...args: ConstructorParameters<typeof _LateApiClient>
): InstanceType<typeof _LateApiClient> {
  return new _LateApiClient(...args)
}

export type { LateApiClient } from '../../L2-clients/late/lateApi.js'
export type {
  LateAccount,
  LateProfile,
  LatePost,
  LateMediaPresignResult,
  LateMediaUploadResult,
  CreatePostParams,
} from '../../L2-clients/late/lateApi.js'

/**
 * Reorder a Late queue so newest-created posts get the earliest slots.
 *
 * Algorithm (temp queue swap):
 * 1. Fetch all scheduled posts in the target queue
 * 2. Create a temporary queue
 * 3. Move all posts to the temp queue (breaks slot associations)
 * 4. Move posts back to the original queue in newest-first order (Late assigns FIFO)
 * 5. Delete the temp queue
 *
 * @returns Summary with moved count and errors
 */
export async function reorderQueue(
  platform: string,
  clipType: string,
  options?: { dryRun?: boolean },
): Promise<{ moved: number; errors: number; order: Array<{ id: string; createdAt: string; newSlot?: string }> }> {
  const client = createLateApiClient()
  const queueId = await getQueueId(platform, clipType)
  const profileId = await getProfileId()

  if (!queueId) {
    logger.warn(`No queue found for ${platform}/${clipType}`)
    return { moved: 0, errors: 0, order: [] }
  }

  // Fetch all scheduled posts and filter to this queue
  const allPosts = await client.getScheduledPosts(platform)
  const queuePosts = allPosts.filter(p => (p as unknown as Record<string, unknown>).queueId === queueId && p.scheduledFor)

  if (queuePosts.length === 0) {
    logger.info(`No posts in ${platform}/${clipType} queue — nothing to reorder`)
    return { moved: 0, errors: 0, order: [] }
  }

  // Sort newest-created first
  const sorted = [...queuePosts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  logger.info(`Reordering ${platform}/${clipType}: ${sorted.length} posts (newest-first)`)

  if (options?.dryRun) {
    const slots = queuePosts.map(p => p.scheduledFor!).sort()
    const order = sorted.map((p, i) => ({
      id: p._id,
      createdAt: p.createdAt,
      newSlot: slots[i],
    }))
    for (const entry of order) {
      logger.info(`  ${entry.createdAt.slice(0, 10)} → ${entry.newSlot?.slice(0, 10)}  [${entry.id.slice(-8)}]`)
    }
    return { moved: sorted.length, errors: 0, order }
  }

  // Create temp queue
  const tempResult = await client.createQueue({
    profileId,
    name: `temp-${platform}-${clipType}`,
    timezone: 'America/Chicago',
    slots: [{ dayOfWeek: 0, time: '04:00' }],
    active: true,
  })
  const tempQueueId = tempResult.schedule?._id
  if (!tempQueueId) {
    logger.error('Failed to create temp queue')
    return { moved: 0, errors: queuePosts.length, order: [] }
  }

  let errors = 0

  // Move all posts to temp queue
  logger.info(`  Moving ${sorted.length} posts to temp queue...`)
  for (const p of queuePosts) {
    try {
      await client.updatePost(p._id, { queuedFromProfile: profileId, queueId: tempQueueId })
    } catch {
      errors++
    }
    await new Promise(r => setTimeout(r, 200))
  }

  await new Promise(r => setTimeout(r, 500))

  // Re-queue in newest-first order
  logger.info(`  Re-queuing newest-first...`)
  const order: Array<{ id: string; createdAt: string; newSlot?: string }> = []
  for (const p of sorted) {
    try {
      const result = await client.updatePost(p._id, {
        queuedFromProfile: profileId,
        queueId,
        isDraft: false,
      })
      order.push({ id: p._id, createdAt: p.createdAt, newSlot: (result as unknown as Record<string, unknown>).scheduledFor as string })
    } catch {
      errors++
      order.push({ id: p._id, createdAt: p.createdAt })
    }
    await new Promise(r => setTimeout(r, 200))
  }

  // Delete temp queue
  try {
    await client.deleteQueue(profileId, tempQueueId)
  } catch {
    logger.warn('Failed to delete temp queue — clean up manually')
  }

  logger.info(`✅ Reordered ${platform}/${clipType}: ${sorted.length} posts, ${errors} errors`)
  return { moved: sorted.length, errors, order }
}

/**
 * Reorder ALL Late queues (newest-created → earliest slot).
 */
export async function reorderAllQueues(
  options?: { dryRun?: boolean },
): Promise<{ total: number; errors: number }> {
  const { getAllQueueMappings } = await import('../queueMapping/queueMapping.js')
  const mappings = await getAllQueueMappings()

  let total = 0
  let errors = 0

  for (const queueName of Object.keys(mappings)) {
    const parts = queueName.split('-')
    const platform = parts[0]
    const clipType = parts.slice(1).join('-') || 'short'
    // Reverse the normalization: 'medium' → 'medium-clip' for getQueueId
    const fullClipType = clipType === 'medium' ? 'medium-clip' : clipType

    logger.info(`\n── ${queueName} ──`)
    const result = await reorderQueue(platform, fullClipType, options)
    total += result.moved
    errors += result.errors
  }

  logger.info(`\n✅ All queues reordered: ${total} posts, ${errors} errors`)
  return { total, errors }
}

/**
 * Priority queue shift — cascade-reschedule all posts in a platform/clipType queue
 * to free the first slot for a priority post.
 *
 * Algorithm:
 * 1. Get all scheduled posts for the platform, sorted by date
 * 2. Take the first post's date — that's the freed slot
 * 3. Shift each post to the next post's date (working backwards to avoid conflicts)
 * 4. The last post gets the next available queue slot after its original date
 *
 * @returns The freed slot (ISO string) or null if queue is empty/no queue found
 */
export async function priorityShiftQueue(
  platform: string,
  clipType: string,
): Promise<{ freedSlot: string; shiftedCount: number } | null> {
  const client = createLateApiClient()

  const queueId = await getQueueId(platform, clipType)
  const profileId = await getProfileId()

  if (!queueId) {
    logger.warn(`No queue found for ${platform}/${clipType} — cannot priority shift`)
    return null
  }

  // Get all scheduled posts for this platform and filter to posts in this specific queue
  // Posts created via queue have their scheduledFor matching queue slot times
  const allPosts = await client.getScheduledPosts(platform)

  // Get the queue's slot schedule to identify which posts belong to this queue
  const preview = await client.previewQueue(profileId, queueId, 100)
  const queueSlotTimes = new Set(preview.slots ?? [])

  // Also get the queue definition to match by time-of-day pattern
  const { queues } = await client.listQueues(profileId, true)
  const queue = queues.find(q => q._id === queueId)
  const queueTimePatterns = new Set(queue?.slots?.map(s => s.time) ?? [])

  // Filter posts to those whose scheduled time matches this queue's time patterns
  const sorted = allPosts
    .filter(p => {
      if (!p.scheduledFor) return false
      // Match by time-of-day (HH:MM) from the queue slot definition
      const postTime = p.scheduledFor.slice(11, 16) // Extract HH:MM from ISO
      return queueTimePatterns.has(postTime)
    })
    .sort((a, b) => a.scheduledFor!.localeCompare(b.scheduledFor!))

  if (sorted.length === 0) {
    logger.info(`No scheduled posts in ${platform}/${clipType} queue — no shift needed`)
    return null
  }

  const freedSlot = sorted[0].scheduledFor!

  // Find next slot AFTER the last post's current date
  const lastPostDate = sorted[sorted.length - 1].scheduledFor!
  const nextSlotForLast = preview.slots?.find(s => s > lastPostDate)

  if (!nextSlotForLast) {
    // If we can't find a slot in preview, the last post stays where it is
    // and we only shift posts 0..n-2
    logger.warn(`No queue slot found after ${lastPostDate} — shifting all except last post`)
    if (sorted.length < 2) {
      logger.info(`Only 1 post in queue — cannot shift`)
      return null
    }

    // Shift all except the last: each takes the next post's slot
    logger.info(`Priority shift: freeing ${freedSlot} for ${platform}/${clipType}`)
    logger.info(`  Shifting ${sorted.length - 1} posts (last post stays at ${lastPostDate})`)

    for (let i = sorted.length - 2; i >= 0; i--) {
      const post = sorted[i]
      const newDate = sorted[i + 1].scheduledFor!
      if (post.scheduledFor === newDate) continue
      logger.info(`  Rescheduling [${post._id.slice(-8)}]: ${post.scheduledFor} → ${newDate}`)
      await client.schedulePost(post._id, newDate)
    }

    logger.info(`✅ Priority shift complete: freed ${freedSlot}, shifted ${sorted.length - 1} posts`)
    return { freedSlot, shiftedCount: sorted.length - 1 }
  }

  logger.info(`Priority shift: freeing ${freedSlot} for ${platform}/${clipType}`)
  logger.info(`  Shifting ${sorted.length} posts, last post → ${nextSlotForLast}`)

  // Work backwards to avoid scheduling conflicts
  for (let i = sorted.length - 1; i >= 0; i--) {
    const post = sorted[i]
    const newDate = i < sorted.length - 1 ? sorted[i + 1].scheduledFor! : nextSlotForLast
    const oldDate = post.scheduledFor!

    if (oldDate === newDate) continue

    logger.info(`  Rescheduling [${post._id.slice(-8)}]: ${oldDate} → ${newDate}`)
    await client.schedulePost(post._id, newDate)
  }

  logger.info(`✅ Priority shift complete: freed ${freedSlot}, shifted ${sorted.length} posts`)
  return { freedSlot, shiftedCount: sorted.length }
}
