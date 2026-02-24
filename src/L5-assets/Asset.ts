/**
 * Asset Base Class
 *
 * Abstract base class for all pipeline assets (videos, transcripts, captions, etc.).
 * Provides a common interface for lazy loading, caching, and regeneration of assets.
 *
 * Assets follow the "compute once, cache forever" pattern:
 * - `exists()` checks if the asset is already on disk
 * - `isComplete()` checks if the completion marker exists (generation finished successfully)
 * - `getResult()` returns the asset, computing it only if needed
 * - `generate()` forces regeneration even if the asset exists
 *
 * @example
 * ```typescript
 * class TranscriptAsset extends Asset<Transcript> {
 *   getCompletionMarkerPath(): string {
 *     return `${this.transcriptPath}.complete`
 *   }
 *
 *   async exists(): Promise<boolean> {
 *     return fs.existsSync(this.transcriptPath)
 *   }
 *
 *   async getResult(opts?: AssetOptions): Promise<Transcript> {
 *     if (opts?.force) {
 *       await this.clearCompletion()
 *     }
 *     if (await this.isComplete()) {
 *       return this.loadFromDisk()
 *     }
 *     const result = await this.transcribe()
 *     await this.markComplete()
 *     return result
 *   }
 * }
 * ```
 */

import { fileExists, writeTextFile, removeFile } from '../L1-infra/fileSystem/fileSystem.js'

/**
 * Options for asset generation and retrieval.
 */
export interface AssetOptions {
  /** Regenerate the asset even if it already exists on disk */
  force?: boolean
  /** Custom prompt for AI-generated assets */
  prompt?: string
  /** Override the default model for AI generation */
  model?: string
}

/**
 * Abstract base class for pipeline assets.
 *
 * @typeParam T - The type of the asset's result (e.g., Transcript, Caption[], VideoMetadata)
 */
export abstract class Asset<T> {
  /** In-memory cache for computed values */
  protected cache: Map<string, unknown> = new Map()

  /** Cached result of the asset */
  protected _result: T | undefined

  /**
   * Get the path where the completion marker file should be written.
   * Each asset defines its own marker location (typically `${primaryOutputPath}.complete`).
   *
   * @returns Absolute path to the .complete marker file
   */
  abstract getCompletionMarkerPath(): string

  /**
   * Get the asset result, computing it if necessary.
   *
   * Implementations should check `opts.force` and `isComplete()` to determine
   * whether to load from disk or regenerate.
   *
   * @param opts - Options controlling generation behavior
   * @returns The asset result
   */
  abstract getResult(opts?: AssetOptions): Promise<T>

  /**
   * Check if the asset already exists on disk.
   *
   * @returns true if the asset exists and doesn't need regeneration
   */
  abstract exists(): Promise<boolean>

  /**
   * Check if the completion marker file exists.
   * This confirms the full generation pipeline finished successfully.
   *
   * Note: `exists()` checks if the primary output file is present,
   * while `isComplete()` checks if generation finished successfully.
   * Both may be needed for full validation.
   *
   * @returns true if the completion marker exists
   */
  async isComplete(): Promise<boolean> {
    return fileExists(this.getCompletionMarkerPath())
  }

  /**
   * Write the completion marker file with the current ISO timestamp.
   * Call this after successful generation to mark the asset as complete.
   */
  protected async markComplete(): Promise<void> {
    await writeTextFile(this.getCompletionMarkerPath(), new Date().toISOString())
  }

  /**
   * Delete the completion marker file.
   * Silently ignores if the file doesn't exist.
   * Call this when forcing regeneration.
   */
  protected async clearCompletion(): Promise<void> {
    await removeFile(this.getCompletionMarkerPath())
  }

  /**
   * Force regeneration of the asset, bypassing any cached or on-disk version.
   *
   * @param opts - Additional options (force is automatically set to true)
   * @returns The newly generated asset result
   */
  async generate(opts?: AssetOptions): Promise<T> {
    return this.getResult({ ...opts, force: true })
  }

  /**
   * Clear the in-memory cache.
   *
   * Useful when you need to force re-computation of cached helper values
   * without regenerating the entire asset.
   */
  clearCache(): void {
    this.cache.clear()
    this._result = undefined
  }

  /**
   * Cache helper for expensive computations.
   *
   * Stores the result of `fn` under `key` and returns it on subsequent calls.
   *
   * @param key - Unique cache key
   * @param fn - Function to compute the value if not cached
   * @returns The cached or newly computed value
   *
   * @example
   * ```typescript
   * const metadata = await this.cached('metadata', () => this.extractMetadata())
   * ```
   */
  protected async cached<V>(key: string, fn: () => Promise<V>): Promise<V> {
    if (this.cache.has(key)) {
      return this.cache.get(key) as V
    }
    const value = await fn()
    this.cache.set(key, value)
    return value
  }
}
