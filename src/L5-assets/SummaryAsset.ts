/**
 * SummaryAsset Class
 *
 * Represents the README.md summary for a video. Wraps the summary file
 * with lazy loading and optional generation via SummaryAgent.
 */
import { TextAsset } from './TextAsset.js'
import { join } from '../L1-infra/paths/paths.js'
import { generateSummary } from '../L4-agents/SummaryAgent.js'
import type { AssetOptions } from './Asset.js'
import type { MainVideoAsset } from './MainVideoAsset.js'

/**
 * Summary asset representing a video's README.md.
 *
 * Provides lazy loading from disk. Generation via SummaryAgent
 * requires transcript, shorts, and chapters data - handled by the pipeline.
 */
export class SummaryAsset extends TextAsset {
  /** Parent video this summary belongs to */
  readonly parent: MainVideoAsset

  /** Path to README.md file */
  readonly filePath: string

  /**
   * Create a summary asset for a video.
   *
   * @param parent - The video asset this summary belongs to
   */
  constructor(parent: MainVideoAsset) {
    super()
    this.parent = parent
    this.filePath = join(parent.videoDir, 'README.md')
  }

  /**
   * Get the summary content.
   *
   * Loads from disk if available. Otherwise generates via SummaryAgent
   * using transcript, shorts, and chapters data from parent.
   *
   * @param opts - Options controlling retrieval behavior
   * @returns The summary markdown content
   */
  async getResult(opts?: AssetOptions): Promise<string> {
    if (opts?.force) {
      this.clearCache()
    }

    return this.cached('content', async () => {
      // Check disk first
      const content = await this.loadFromDisk()
      if (!opts?.force && content !== null) {
        return content
      }

      // Generate via SummaryAgent
      const transcript = await this.parent.getTranscript()
      const shortAssets = await this.parent.getShorts()
      const shorts = shortAssets.map((s) => s.clip) // Get raw clip data
      const chapters = await this.parent.getChapters()
      const videoFile = await this.parent.toVideoFile()

      // Agent writes README.md to disk, just need to collect metadata and reload
      await generateSummary(videoFile, transcript, shorts, chapters)

      // The README was written by the agent, reload from disk
      const generated = await this.loadFromDisk()
      if (generated !== null) {
        return generated
      }

      throw new Error('SummaryAgent failed to generate README')
    })
  }
}
