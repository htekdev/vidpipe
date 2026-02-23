/**
 * TextAsset Base Class
 *
 * Abstract base class for text-based assets (blog posts, summaries, social posts).
 * Subclasses define where the content is stored and how it's generated.
 *
 * Provides common functionality for reading from and writing to disk,
 * with the Asset pattern of lazy loading and caching.
 */
import { Asset, AssetOptions } from './Asset.js'
import { fileExists, readTextFile, writeTextFile } from '../L1-infra/fileSystem/fileSystem.js'

/**
 * Base class for text-based assets.
 *
 * Subclasses must implement:
 * - `filePath`: Where the text file lives on disk
 * - `getResult()`: How to generate/load the content
 */
export abstract class TextAsset extends Asset<string> {
  /** Path to the text file on disk */
  abstract readonly filePath: string

  /**
   * Get the path to the completion marker file.
   * For text assets, this is the filePath with .complete appended.
   */
  getCompletionMarkerPath(): string {
    return `${this.filePath}.complete`
  }

  /**
   * Get the text content (from disk or memory cache).
   *
   * @param opts - Options controlling generation behavior
   * @returns The text content
   */
  async getContent(opts?: AssetOptions): Promise<string> {
    return this.getResult(opts)
  }

  /**
   * Check if the text file exists on disk.
   *
   * @returns true if the file exists
   */
  async exists(): Promise<boolean> {
    return fileExists(this.filePath)
  }

  /**
   * Load content from disk.
   *
   * @returns File content if exists, null otherwise
   */
  protected async loadFromDisk(): Promise<string | null> {
    if (!(await this.exists())) {
      return null
    }
    return readTextFile(this.filePath)
  }

  /**
   * Save content to disk.
   *
   * Creates parent directories if they don't exist.
   *
   * @param content - The text content to write
   */
  protected async saveToDisk(content: string): Promise<void> {
    await writeTextFile(this.filePath, content)
  }
}
