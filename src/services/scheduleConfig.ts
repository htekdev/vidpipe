import { readTextFile, writeFileRaw } from '../core/fileSystem.js'
import { join } from '../core/paths.js'
import logger from '../config/logger.js'

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface TimeSlot {
  days: DayOfWeek[]
  time: string // HH:MM format
  label: string
}

export interface ClipTypeSchedule {
  slots: TimeSlot[]
  avoidDays: DayOfWeek[]
}

export interface PlatformSchedule {
  slots: TimeSlot[]
  avoidDays: DayOfWeek[]
  byClipType?: Record<string, ClipTypeSchedule>
}

export interface ScheduleConfig {
  timezone: string
  platforms: Record<string, PlatformSchedule>
}

const VALID_DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

let cachedConfig: ScheduleConfig | null = null

export function getDefaultScheduleConfig(): ScheduleConfig {
  return {
    timezone: 'America/Chicago',
    platforms: {
      linkedin: {
        slots: [
          { days: ['tue', 'wed'], time: '08:00', label: 'Morning thought leadership' },
          { days: ['tue', 'wed', 'thu'], time: '12:00', label: 'Lunch break engagement' },
        ],
        avoidDays: ['sat', 'sun'],
      },
      tiktok: {
        slots: [
          { days: ['tue', 'wed', 'thu'], time: '19:00', label: 'Prime entertainment hours' },
          { days: ['fri', 'sat'], time: '21:00', label: 'Weekend evening' },
        ],
        avoidDays: [],
      },
      instagram: {
        slots: [
          { days: ['tue', 'wed', 'thu'], time: '10:00', label: 'Morning scroll' },
          { days: ['wed', 'thu', 'fri'], time: '19:30', label: 'Evening couch time' },
        ],
        avoidDays: [],
      },
      youtube: {
        slots: [
          { days: ['fri'], time: '15:00', label: 'Afternoon pre-weekend' },
          { days: ['thu', 'fri'], time: '20:00', label: 'Prime evening viewing' },
        ],
        avoidDays: ['mon'],
      },
      twitter: {
        slots: [
          { days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '08:30', label: 'Morning news check' },
          { days: ['tue', 'wed', 'thu'], time: '12:00', label: 'Lunch scroll' },
          { days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '17:00', label: 'Commute home' },
        ],
        avoidDays: [],
      },
    },
  }
}

function validateSlots(slots: unknown[], context: string): TimeSlot[] {
  const validatedSlots: TimeSlot[] = []
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i] as Record<string, unknown>

    if (!Array.isArray(slot.days) || slot.days.length === 0) {
      throw new Error(`${context} slot ${i} must have a non-empty "days" array`)
    }

    for (const day of slot.days) {
      if (!VALID_DAYS.includes(day as DayOfWeek)) {
        throw new Error(`${context} slot ${i} has invalid day "${day}". Valid: ${VALID_DAYS.join(', ')}`)
      }
    }

    if (typeof slot.time !== 'string' || !TIME_REGEX.test(slot.time)) {
      throw new Error(`${context} slot ${i} "time" must match HH:MM format (00:00–23:59)`)
    }

    if (typeof slot.label !== 'string' || slot.label.trim() === '') {
      throw new Error(`${context} slot ${i} must have a non-empty "label" string`)
    }

    validatedSlots.push({
      days: slot.days as DayOfWeek[],
      time: slot.time,
      label: slot.label,
    })
  }
  return validatedSlots
}

function validateAvoidDays(avoidDays: unknown[], context: string): DayOfWeek[] {
  for (const day of avoidDays) {
    if (!VALID_DAYS.includes(day as DayOfWeek)) {
      throw new Error(`${context} avoidDays contains invalid day "${day}". Valid: ${VALID_DAYS.join(', ')}`)
    }
  }
  return avoidDays as DayOfWeek[]
}

function validateByClipType(byClipType: Record<string, unknown>, platformName: string): Record<string, ClipTypeSchedule> {
  const validated: Record<string, ClipTypeSchedule> = {}

  for (const [clipType, value] of Object.entries(byClipType)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Platform "${platformName}" byClipType "${clipType}" must be an object`)
    }

    const sub = value as Record<string, unknown>

    if (!Array.isArray(sub.slots)) {
      throw new Error(`Platform "${platformName}" byClipType "${clipType}" must have a "slots" array`)
    }

    const rawAvoidDays = Array.isArray(sub.avoidDays) ? sub.avoidDays : []

    validated[clipType] = {
      slots: validateSlots(sub.slots, `Platform "${platformName}" byClipType "${clipType}"`),
      avoidDays: validateAvoidDays(rawAvoidDays, `Platform "${platformName}" byClipType "${clipType}"`),
    }
  }

  // Check for overlapping (day, time) pairs across clip types
  const clipTypes = Object.keys(validated)
  for (let a = 0; a < clipTypes.length; a++) {
    const aSlots = validated[clipTypes[a]]
    const aTimeDays = new Set<string>()
    for (const slot of aSlots.slots) {
      for (const day of slot.days) {
        aTimeDays.add(`${day}@${slot.time}`)
      }
    }

    for (let b = a + 1; b < clipTypes.length; b++) {
      const bSlots = validated[clipTypes[b]]
      for (const slot of bSlots.slots) {
        for (const day of slot.days) {
          if (aTimeDays.has(`${day}@${slot.time}`)) {
            logger.warn(
              `Platform "${platformName}": clip types "${clipTypes[a]}" and "${clipTypes[b]}" have overlapping slot (${day}, ${slot.time})`
            )
          }
        }
      }
    }
  }

  return validated
}

export function validateScheduleConfig(config: unknown): ScheduleConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Schedule config must be a non-null object')
  }

  const cfg = config as Record<string, unknown>

  if (typeof cfg.timezone !== 'string' || cfg.timezone.trim() === '') {
    throw new Error('Schedule config "timezone" must be a non-empty string')
  }

  if (!cfg.platforms || typeof cfg.platforms !== 'object' || Array.isArray(cfg.platforms)) {
    throw new Error('Schedule config "platforms" must be an object')
  }

  const platforms = cfg.platforms as Record<string, unknown>
  const validated: ScheduleConfig = {
    timezone: cfg.timezone,
    platforms: {},
  }

  for (const [name, value] of Object.entries(platforms)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Platform "${name}" must be an object`)
    }

    const plat = value as Record<string, unknown>
    const hasByClipType = plat.byClipType && typeof plat.byClipType === 'object' && !Array.isArray(plat.byClipType)

    // When byClipType is present, flat slots/avoidDays are optional defaults
    const hasSlots = Array.isArray(plat.slots)
    const hasAvoidDays = Array.isArray(plat.avoidDays)

    if (!hasByClipType) {
      if (!hasSlots) {
        throw new Error(`Platform "${name}" must have a "slots" array`)
      }
      if (!hasAvoidDays) {
        throw new Error(`Platform "${name}" must have an "avoidDays" array`)
      }
    }

    const validatedSlots = hasSlots
      ? validateSlots(plat.slots as unknown[], `Platform "${name}"`)
      : []
    const validatedAvoidDays = hasAvoidDays
      ? validateAvoidDays(plat.avoidDays as unknown[], `Platform "${name}"`)
      : []

    const result: PlatformSchedule = {
      slots: validatedSlots,
      avoidDays: validatedAvoidDays,
    }

    if (hasByClipType) {
      result.byClipType = validateByClipType(plat.byClipType as Record<string, unknown>, name)
    }

    validated.platforms[name] = result
  }

  return validated
}

export async function loadScheduleConfig(configPath?: string): Promise<ScheduleConfig> {
  if (cachedConfig) return cachedConfig

  const filePath = configPath ?? join(process.cwd(), 'schedule.json')

  let raw: string
  try {
    raw = await readTextFile(filePath)
  } catch {
    logger.info(`No schedule.json found at ${filePath}, creating with defaults`)
    const defaults = getDefaultScheduleConfig()
    // Write directly with exclusive create flag for security
    try {
      await writeFileRaw(filePath, JSON.stringify(defaults, null, 2), { 
        encoding: 'utf-8',
        flag: 'wx',
        mode: 0o600
      })
    } catch (err: any) {
      // If file was created by another process in a race, read it
      if (err.code === 'EEXIST') {
        const raw = await readTextFile(filePath)
        const parsed: unknown = JSON.parse(raw)
        cachedConfig = validateScheduleConfig(parsed)
        logger.info(`Loaded schedule config from ${filePath}`)
        return cachedConfig
      }
      throw err
    }
    cachedConfig = defaults
    return defaults
  }

  const parsed: unknown = JSON.parse(raw)
  cachedConfig = validateScheduleConfig(parsed)
  logger.info(`Loaded schedule config from ${filePath}`)
  return cachedConfig
}

export function getPlatformSchedule(platform: string, clipType?: string): PlatformSchedule | null {
  if (!cachedConfig) return null
  const schedule = cachedConfig.platforms[platform] ?? null
  if (!schedule) return null

  if (clipType && schedule.byClipType?.[clipType]) {
    const sub = schedule.byClipType[clipType]
    return {
      slots: sub.slots,
      avoidDays: sub.avoidDays,
    }
  }

  return schedule
}

export function clearScheduleCache(): void {
  cachedConfig = null
}
