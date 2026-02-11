// Re-export all commonly used path functions
export { join, resolve, dirname, basename, extname, parse, sep, relative, normalize } from 'path'
export { fileURLToPath } from 'url'

// Also re-export the path module itself for the rare cases where namespace import is needed
import pathMod from 'path'
export { pathMod }

import { existsSync } from 'fs'
import { join, resolve, dirname, parse } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Walk up from `startDir` until a directory containing `package.json` is found.
 * Throws if the filesystem root is reached without finding one.
 */
export function findRoot(startDir: string): string {
  let dir = resolve(startDir)
  while (true) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`Could not find project root from ${startDir}`)
    dir = parent
  }
}

let _cachedRoot: string | undefined

/** Get the project root directory. */
export function projectRoot(): string {
  if (!_cachedRoot) _cachedRoot = findRoot(__dirname)
  return _cachedRoot
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

/**
 * Resolve the models directory — checks bundled (dist/models/) first,
 * falls back to dev (assets/models/).
 */
export function modelsDir(): string {
  const bundled = resolve(projectRoot(), 'dist', 'models')
  return existsSync(bundled) ? bundled : assetsDir('models')
}

/** Get the recordings directory, optionally for a specific slug. */
export function recordingsDir(slug?: string): string {
  return slug ? join(projectRoot(), 'recordings', slug) : join(projectRoot(), 'recordings')
}
