import { readTextFile, writeFileRaw } from '../../L1-infra/fileSystem/fileSystem.js'
import { join } from '../../L1-infra/paths/paths.js'

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
 * Resolve the default schedule config file path.
 */
export function resolveSchedulePath(configPath?: string): string {
  return configPath ?? join(process.cwd(), 'schedule.json')
}
