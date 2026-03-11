import slugifyLib from 'slugify'
import { v4 as uuidv4 } from 'uuid'

/** Slugify text for use in URLs and file names. */
export function slugify(text: string, opts?: { lower?: boolean; strict?: boolean; replacement?: string }): string {
  return slugifyLib(text, { lower: true, strict: true, ...opts })
}

/** Generate a UUID v4. */
export function generateId(): string {
  return uuidv4()
}
