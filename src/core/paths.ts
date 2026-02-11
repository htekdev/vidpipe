// Re-export all commonly used path functions
export { join, resolve, dirname, basename, extname, parse, sep, relative, normalize } from 'path'
export { fileURLToPath } from 'url'

// Also re-export the path module itself for the rare cases where namespace import is needed
import pathMod from 'path'
export { pathMod }

import { existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Get the project root directory. */
export function projectRoot(): string {
  return resolve(__dirname, '..', '..')
}

/** Get path within the assets directory. */
export function assetsDir(...segments: string[]): string {
  return join(projectRoot(), 'assets', ...segments)
}

/**
 * Resolve the fonts directory — checks bundled (dist/fonts/) first,
 * falls back to dev (assets/fonts/).
 */
export function fontsDir(): string {
  const bundled = resolve(projectRoot(), 'dist', 'fonts')
  return existsSync(bundled) ? bundled : assetsDir('fonts')
}

/** Get the recordings directory, optionally for a specific slug. */
export function recordingsDir(slug?: string): string {
  return slug ? join(projectRoot(), 'recordings', slug) : join(projectRoot(), 'recordings')
}
