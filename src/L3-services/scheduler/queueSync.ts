/**
 * Queue Sync Service — syncs schedule.json configuration to Late API queues.
 *
 * Creates one Late API queue per (platform × clipType) combination.
 * schedule.json is the declarative desired-state; Late API is the runtime scheduler.
 */
import { LateApiClient, type LateQueue, type LateQueueSlot } from '../../L2-clients/late/lateApi.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { loadScheduleConfig, type DayOfWeek, type TimeSlot, type ScheduleConfig } from './scheduleConfig.js'

// ── Types ──────────────────────────────────────────────────────────────

export interface QueueMapping {
  platform: string
  clipType: string
  queueId: string
  queueName: string
}

export interface SyncPlan {
  toCreate: Array<{ name: string; platform: string; clipType: string; slots: LateQueueSlot[] }>
  toUpdate: Array<{ queueId: string; name: string; platform: string; clipType: string; slots: LateQueueSlot[]; currentSlots: LateQueueSlot[] }>
  unchanged: Array<{ queueId: string; name: string }>
  toDelete: Array<{ queueId: string; name: string }>
}

export interface SyncResult {
  created: number
  updated: number
  unchanged: number
  deleted: number
  errors: Array<{ name: string; error: string }>
  mapping: QueueMapping[]
}

// ── Day conversion ─────────────────────────────────────────────────────

const DAY_TO_NUMBER: Record<DayOfWeek, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

function timeSlotsToLateSlots(slots: readonly TimeSlot[]): LateQueueSlot[] {
  const lateSlots: LateQueueSlot[] = []
  for (const slot of slots) {
    for (const day of slot.days) {
      lateSlots.push({ dayOfWeek: DAY_TO_NUMBER[day], time: slot.time })
    }
  }
  lateSlots.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.time.localeCompare(b.time))
  return lateSlots
}

function makeQueueName(platform: string, clipType: string): string {
  return `${platform}-${clipType}s`
}

function slotsAreEqual(a: readonly LateQueueSlot[], b: readonly LateQueueSlot[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort((x, y) => x.dayOfWeek - y.dayOfWeek || x.time.localeCompare(y.time))
  const sortedB = [...b].sort((x, y) => x.dayOfWeek - y.dayOfWeek || x.time.localeCompare(y.time))
  return sortedA.every((slot, i) => slot.dayOfWeek === sortedB[i].dayOfWeek && slot.time === sortedB[i].time)
}

// ── Core functions ─────────────────────────────────────────────────────

/** Build the desired queue definitions from schedule.json config. */
export function buildDesiredQueues(config: ScheduleConfig): Array<{ name: string; platform: string; clipType: string; slots: LateQueueSlot[] }> {
  const desired: Array<{ name: string; platform: string; clipType: string; slots: LateQueueSlot[] }> = []

  for (const [platform, schedule] of Object.entries(config.platforms)) {
    if (schedule.byClipType) {
      for (const [clipType, clipSchedule] of Object.entries(schedule.byClipType)) {
        if (clipSchedule.slots.length === 0) continue
        desired.push({
          name: makeQueueName(platform, clipType),
          platform,
          clipType,
          slots: timeSlotsToLateSlots(clipSchedule.slots),
        })
      }
    }
    // Also handle top-level slots (platform without byClipType)
    if (schedule.slots.length > 0) {
      desired.push({
        name: `${platform}-default`,
        platform,
        clipType: 'default',
        slots: timeSlotsToLateSlots(schedule.slots),
      })
    }
  }

  return desired
}

/** Compare desired state with existing Late queues and produce a sync plan. */
export function buildSyncPlan(desired: ReturnType<typeof buildDesiredQueues>, existing: readonly LateQueue[]): SyncPlan {
  const existingByName = new Map(existing.map(q => [q.name, q]))
  const desiredNames = new Set(desired.map(d => d.name))

  const plan: SyncPlan = { toCreate: [], toUpdate: [], unchanged: [], toDelete: [] }

  for (const d of desired) {
    const match = existingByName.get(d.name)
    if (!match) {
      plan.toCreate.push(d)
    } else if (!slotsAreEqual(d.slots, match.slots)) {
      plan.toUpdate.push({
        queueId: match._id,
        name: d.name,
        platform: d.platform,
        clipType: d.clipType,
        slots: d.slots,
        currentSlots: match.slots,
      })
    } else {
      plan.unchanged.push({ queueId: match._id, name: d.name })
    }
  }

  for (const [name, q] of existingByName) {
    if (!desiredNames.has(name)) {
      plan.toDelete.push({ queueId: q._id, name })
    }
  }

  return plan
}

/** Execute a sync plan against the Late API. */
export async function executeSyncPlan(
  plan: SyncPlan,
  client: LateApiClient,
  profileId: string,
  timezone: string,
  options?: { reshuffleExisting?: boolean },
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, unchanged: plan.unchanged.length, deleted: 0, errors: [], mapping: [] }

  // Add unchanged queues to mapping
  for (const q of plan.unchanged) {
    result.mapping.push({ platform: '', clipType: '', queueId: q.queueId, queueName: q.name })
  }

  // Create new queues
  for (const item of plan.toCreate) {
    try {
      const queue = await client.createQueue({
        profileId,
        name: item.name,
        timezone,
        slots: item.slots,
        active: true,
      })
      result.created++
      result.mapping.push({ platform: item.platform, clipType: item.clipType, queueId: queue._id, queueName: item.name })
      logger.info(`Created queue "${item.name}" with ${item.slots.length} slots`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push({ name: item.name, error: msg })
      logger.error(`Failed to create queue "${item.name}": ${msg}`)
    }
  }

  // Update existing queues
  for (const item of plan.toUpdate) {
    try {
      const { schedule } = await client.updateQueue({
        profileId,
        queueId: item.queueId,
        name: item.name,
        timezone,
        slots: item.slots,
        reshuffleExisting: options?.reshuffleExisting,
      })
      result.updated++
      result.mapping.push({ platform: item.platform, clipType: item.clipType, queueId: schedule._id, queueName: item.name })
      logger.info(`Updated queue "${item.name}": ${item.currentSlots.length} → ${item.slots.length} slots`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push({ name: item.name, error: msg })
      logger.error(`Failed to update queue "${item.name}": ${msg}`)
    }
  }

  return result
}

/** High-level: sync schedule.json → Late API queues. */
export async function syncQueuesToLate(options?: {
  dryRun?: boolean
  reshuffleExisting?: boolean
  configPath?: string
}): Promise<{ plan: SyncPlan; result?: SyncResult }> {
  const config = await loadScheduleConfig(options?.configPath)
  const client = new LateApiClient()

  const profiles = await client.listProfiles()
  if (profiles.length === 0) {
    throw new Error('No Late API profiles found. Run setup first.')
  }
  const profileId = profiles[0]._id

  const existingQueues = await client.listQueues(profileId, { all: true })
  const desired = buildDesiredQueues(config)
  const plan = buildSyncPlan(desired, existingQueues)

  logger.info(`Queue sync plan: ${plan.toCreate.length} to create, ${plan.toUpdate.length} to update, ${plan.unchanged.length} unchanged, ${plan.toDelete.length} to delete`)

  if (options?.dryRun) {
    return { plan }
  }

  const result = await executeSyncPlan(plan, client, profileId, config.timezone, {
    reshuffleExisting: options?.reshuffleExisting,
  })

  return { plan, result }
}

/** Get the queue ID for a given platform and clip type. */
export async function resolveQueueId(platform: string, clipType: string): Promise<{ profileId: string; queueId: string } | null> {
  const client = new LateApiClient()
  const profiles = await client.listProfiles()
  if (profiles.length === 0) return null

  const profileId = profiles[0]._id
  const queues = await client.listQueues(profileId, { all: true })
  const queueName = makeQueueName(platform, clipType)
  const queue = queues.find(q => q.name === queueName)

  if (!queue) {
    logger.warn(`No Late API queue found for "${queueName}". Run 'vidpipe sync-queues' first.`)
    return null
  }

  return { profileId, queueId: queue._id }
}
