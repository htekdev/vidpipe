import { readTextFile, writeFileRaw } from '../../L1-infra/fileSystem/fileSystem.js'
import { join } from '../../L1-infra/paths/paths.js'
import { getGlobalConfigValue } from '../../L1-infra/config/globalConfig.js'

/**
 * Read the raw schedule config JSON from disk.
 * Returns the raw string content for L3 to parse and validate.
 */
export async function readScheduleFile(filePath: string): Promise<string> {
  return readTextFile(filePath)
}

/**
 * Write schedule config JSON to disk with exclusive create (wx flag).
 * Throws EEXIST if the file already exists.
 */
export async function writeScheduleFile(filePath: string, content: string): Promise<void> {
  await writeFileRaw(filePath, content, {
    encoding: 'utf-8',
    flag: 'wx',
    mode: 0o600,
  })
}

/**
 * Resolve the schedule config file path.
 * Priority: explicit configPath > global config defaults.scheduleConfig > cwd/schedule.json
 */
export function resolveSchedulePath(configPath?: string): string {
  if (configPath) return configPath
  const globalPath = getGlobalConfigValue('defaults', 'scheduleConfig')
  if (globalPath) return globalPath
  return join(process.cwd(), 'schedule.json')
}
