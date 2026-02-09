import { promises as fs } from 'fs'
import path from 'path'
import logger from '../config/logger'

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface TimeSlot {
  days: DayOfWeek[]
  time: string // HH:MM format
  label: string
}

export interface PlatformSchedule {
  slots: TimeSlot[]
  avoidDays: DayOfWeek[]
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

    if (!Array.isArray(plat.slots)) {
      throw new Error(`Platform "${name}" must have a "slots" array`)
    }

    if (!Array.isArray(plat.avoidDays)) {
      throw new Error(`Platform "${name}" must have an "avoidDays" array`)
    }

    for (const day of plat.avoidDays) {
      if (!VALID_DAYS.includes(day as DayOfWeek)) {
        throw new Error(`Platform "${name}" avoidDays contains invalid day "${day}". Valid: ${VALID_DAYS.join(', ')}`)
      }
    }

    const validatedSlots: TimeSlot[] = []
    for (let i = 0; i < plat.slots.length; i++) {
      const slot = plat.slots[i] as Record<string, unknown>

      if (!Array.isArray(slot.days) || slot.days.length === 0) {
        throw new Error(`Platform "${name}" slot ${i} must have a non-empty "days" array`)
      }

      for (const day of slot.days) {
        if (!VALID_DAYS.includes(day as DayOfWeek)) {
          throw new Error(`Platform "${name}" slot ${i} has invalid day "${day}". Valid: ${VALID_DAYS.join(', ')}`)
        }
      }

      if (typeof slot.time !== 'string' || !TIME_REGEX.test(slot.time)) {
        throw new Error(`Platform "${name}" slot ${i} "time" must match HH:MM format (00:00–23:59)`)
      }

      if (typeof slot.label !== 'string' || slot.label.trim() === '') {
        throw new Error(`Platform "${name}" slot ${i} must have a non-empty "label" string`)
      }

      validatedSlots.push({
        days: slot.days as DayOfWeek[],
        time: slot.time,
        label: slot.label,
      })
    }

    validated.platforms[name] = {
      slots: validatedSlots,
      avoidDays: plat.avoidDays as DayOfWeek[],
    }
  }

  return validated
}

export async function loadScheduleConfig(configPath?: string): Promise<ScheduleConfig> {
  if (cachedConfig) return cachedConfig

  const filePath = configPath ?? path.join(process.cwd(), 'schedule.json')

  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf-8')
  } catch {
    logger.info(`No schedule.json found at ${filePath}, creating with defaults`)
    const defaults = getDefaultScheduleConfig()
    await fs.writeFile(filePath, JSON.stringify(defaults, null, 2), 'utf-8')
    cachedConfig = defaults
    return defaults
  }

  const parsed: unknown = JSON.parse(raw)
  cachedConfig = validateScheduleConfig(parsed)
  logger.info(`Loaded schedule config from ${filePath}`)
  return cachedConfig
}

export function getPlatformSchedule(platform: string): PlatformSchedule | null {
  if (!cachedConfig) return null
  return cachedConfig.platforms[platform] ?? null
}

export function clearScheduleCache(): void {
  cachedConfig = null
}
