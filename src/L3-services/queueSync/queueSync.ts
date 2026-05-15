import { LateApiClient } from '../../L2-clients/late/lateApi.js'
import type { DayOfWeek } from '../scheduler/scheduleConfig.js'
import { loadScheduleConfig } from '../scheduler/scheduleConfig.js'
import { refreshQueueMappings } from '../queueMapping/queueMapping.js'
import logger from '../../L1-infra/logger/configLogger.js'

// ── Types ──────────────────────────────────────────────────────────────

export interface SyncResult {
  created: string[]
  updated: string[]
  deleted: string[]
  unchanged: string[]
  errors: Array<{ queueName: string; error: string }>
}

interface DesiredQueue {
  name: string
  slots: Array<{ dayOfWeek: number; time: string }>
}

interface ExistingQueue {
  _id: string
  name: string
  slots: Array<{ dayOfWeek: number; time: string }>
  active: boolean
}

// ── Constants ──────────────────────────────────────────────────────────

const DAY_MAP: Record<DayOfWeek, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

const PLATFORM_NAME_MAP: Record<string, string> = { twitter: 'x' }

const RATE_LIMIT_DELAY_MS = 200

// ── Helpers ────────────────────────────────────────────────────────────

function normalizePlatformName(platform: string): string {
  return PLATFORM_NAME_MAP[platform] ?? platform
}

function slotsToSortedKey(slots: ReadonlyArray<{ dayOfWeek: number; time: string }>): string {
  const sorted = [...slots].sort((a, b) =>
    a.dayOfWeek !== b.dayOfWeek
      ? a.dayOfWeek - b.dayOfWeek
      : a.time.localeCompare(b.time),
  )
  return JSON.stringify(sorted)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Core ───────────────────────────────────────────────────────────────

function buildDesiredQueues(config: Awaited<ReturnType<typeof loadScheduleConfig>>): DesiredQueue[] {
  const queues: DesiredQueue[] = []

  for (const [platformKey, platformSchedule] of Object.entries(config.platforms)) {
    const normalizedPlatform = normalizePlatformName(platformKey)

    if (!platformSchedule.byClipType) continue

    for (const [clipType, clipTypeSchedule] of Object.entries(platformSchedule.byClipType)) {
      // Queue names use 'medium'/'short'/'video', not 'medium-clip'
      const normalizedClipType = clipType === 'medium-clip' ? 'medium' : clipType
      const queueName = `${normalizedPlatform}-${normalizedClipType}`
      const slots: Array<{ dayOfWeek: number; time: string }> = []

      for (const timeSlot of clipTypeSchedule.slots) {
        for (const day of timeSlot.days) {
          slots.push({ dayOfWeek: DAY_MAP[day], time: timeSlot.time })
        }
      }

      if (slots.length > 0) {
        queues.push({ name: queueName, slots })
      }
    }
  }

  return queues
}

export async function syncQueuesToLate(options?: {
  reshuffle?: boolean
  dryRun?: boolean
  deleteOrphans?: boolean
}): Promise<SyncResult> {
  const reshuffle = options?.reshuffle ?? false
  const dryRun = options?.dryRun ?? false
  const deleteOrphans = options?.deleteOrphans ?? false

  const result: SyncResult = {
    created: [],
    updated: [],
    deleted: [],
    unchanged: [],
    errors: [],
  }

  // 1. Load schedule config
  const config = await loadScheduleConfig()
  const timezone = config.timezone

  // 2. Get Late API client and profile ID
  const client = new LateApiClient()
  const profiles = await client.listProfiles()
  if (profiles.length === 0) {
    throw new Error('No Late API profiles found — cannot sync queues')
  }
  const profileId = profiles[0]._id
  logger.info(`Using Late profile "${profiles[0].name}" (${profileId})`)

  // 3. Build desired queue definitions from schedule config
  const desiredQueues = buildDesiredQueues(config)
  logger.info(`Built ${desiredQueues.length} queue definitions from schedule.json`)

  // 4. Fetch existing queues from Late API
  const existingData = await client.listQueues(profileId, true)
  const existingQueues: ExistingQueue[] = existingData.queues.map((q) => ({
    _id: q._id,
    name: q.name,
    slots: q.slots,
    active: q.active,
  }))
  logger.info(`Found ${existingQueues.length} existing queues in Late`)

  const existingByName = new Map<string, ExistingQueue>()
  for (const eq of existingQueues) {
    existingByName.set(eq.name, eq)
  }

  // 5. Sync each desired queue
  const desiredNames = new Set<string>()

  for (const desired of desiredQueues) {
    desiredNames.add(desired.name)
    const existing = existingByName.get(desired.name)

    if (existing) {
      const existingKey = slotsToSortedKey(existing.slots)
      const desiredKey = slotsToSortedKey(desired.slots)

      if (existingKey === desiredKey) {
        logger.debug(`Queue "${desired.name}" unchanged`)
        result.unchanged.push(desired.name)
      } else {
        logger.info(`Queue "${desired.name}" slots differ — updating`)
        if (!dryRun) {
          try {
            await client.updateQueue({
              profileId,
              queueId: existing._id,
              name: desired.name,
              timezone,
              slots: desired.slots,
              reshuffleExisting: reshuffle,
            })
            result.updated.push(desired.name)
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logger.error(`Failed to update queue "${desired.name}": ${message}`)
            result.errors.push({ queueName: desired.name, error: message })
          }
        } else {
          logger.info(`[DRY RUN] Would update queue "${desired.name}"`)
          result.updated.push(desired.name)
        }
        await delay(RATE_LIMIT_DELAY_MS)
      }
    } else {
      logger.info(`Queue "${desired.name}" does not exist — creating`)
      if (!dryRun) {
        try {
          await client.createQueue({
            profileId,
            name: desired.name,
            timezone,
            slots: desired.slots,
            active: true,
          })
          result.created.push(desired.name)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.error(`Failed to create queue "${desired.name}": ${message}`)
          result.errors.push({ queueName: desired.name, error: message })
        }
      } else {
        logger.info(`[DRY RUN] Would create queue "${desired.name}"`)
        result.created.push(desired.name)
      }
      await delay(RATE_LIMIT_DELAY_MS)
    }
  }

  // 6. Delete orphan queues (exist in Late but not in schedule.json)
  if (deleteOrphans) {
    for (const existing of existingQueues) {
      if (!desiredNames.has(existing.name)) {
        logger.info(`Orphan queue "${existing.name}" — deleting`)
        if (!dryRun) {
          try {
            await client.deleteQueue(profileId, existing._id)
            result.deleted.push(existing.name)
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logger.error(`Failed to delete orphan queue "${existing.name}": ${message}`)
            result.errors.push({ queueName: existing.name, error: message })
          }
        } else {
          logger.info(`[DRY RUN] Would delete orphan queue "${existing.name}"`)
          result.deleted.push(existing.name)
        }
        await delay(RATE_LIMIT_DELAY_MS)
      }
    }
  }

  // 7. Refresh queue mapping cache so getQueueId() sees the changes immediately
  if (!dryRun) {
    await refreshQueueMappings()
  }

  // 8. Log summary
  logger.info(
    `Queue sync complete: ${result.created.length} created, ${result.updated.length} updated, ` +
    `${result.deleted.length} deleted, ${result.unchanged.length} unchanged, ${result.errors.length} errors`,
  )

  return result
}
