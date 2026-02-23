/**
 * MainVideoAsset Class
 *
 * The primary video asset that the pipeline processes. Represents a source video
 * being processed through all pipeline stages.
 *
 * Provides lazy-loading access to:
 * - Video variants (original, edited, enhanced, captioned, produced)
 * - Child assets (shorts, medium clips, chapters)
 * - Text assets (summary, blog)
 */
import { VideoAsset, VideoMetadata, CaptionFiles } from './VideoAsset.js'
import { AssetOptions } from './Asset.js'
import { ShortVideoAsset } from './ShortVideoAsset.js'
import { MediumClipAsset } from './MediumClipAsset.js'
import { BlogAsset } from './BlogAsset.js'
import { join, basename, extname, dirname } from '../L1-infra/paths/paths.js'
import {
  fileExists,
  ensureDirectory,
  copyFile,
  getFileStats,
  listDirectory,
  removeDirectory,
  removeFile,
  openReadStream,
  openWriteStream,
  writeJsonFile,
  readJsonFile,
  readTextFile,
  writeTextFile,
} from '../L1-infra/fileSystem/fileSystem.js'
import { slugify } from '../L0-pure/text/text.js'
import { ffprobe, burnCaptions } from '../L4-agents/videoServiceBridge.js'
import { transcribeVideo, analyzeVideoClipDirection } from '../L4-agents/analysisServiceBridge.js'
import { removeDeadSilence } from '../L4-agents/SilenceRemovalAgent.js'
import { generateShorts } from '../L4-agents/ShortsAgent.js'
import { generateMediumClips } from '../L4-agents/MediumVideoAgent.js'
import { generateChapters } from '../L4-agents/ChapterAgent.js'
import { ProducerAgent } from '../L4-agents/ProducerAgent.js'
import { generateSummary } from '../L4-agents/SummaryAgent.js'
import { generateSocialPosts, generateShortPosts } from '../L4-agents/SocialMediaAgent.js'
import { generateBlogPost } from '../L4-agents/BlogAgent.js'
import { buildPublishQueue, commitAndPush } from '../L4-agents/pipelineServiceBridge.js'
import { enhanceVideo } from './visualEnhancement.js'
import { getConfig } from '../L1-infra/config/environment.js'
import logger from '../L1-infra/logger/configLogger.js'
import type { ProduceResult } from '../L4-agents/ProducerAgent.js'
import type { QueueBuildResult } from '../L4-agents/pipelineServiceBridge.js'
import {
  Platform,
} from '../L0-pure/types/index.js'
import type {
  ShortClip,
  MediumClip,
  Chapter,
  Transcript,
  VideoFile,
  VideoLayout,
  AspectRatio,
  VideoSummary,
  SocialPost,
  WebcamRegion,
} from '../L0-pure/types/index.js'

/**
 * Main video asset - the entry point for pipeline processing.
 * Represents a source video that has been or will be ingested into the recordings folder.
 */
export class MainVideoAsset extends VideoAsset {
  readonly sourcePath: string
  readonly videoDir: string
  readonly slug: string

  private constructor(sourcePath: string, videoDir: string, slug: string) {
    super()
    this.sourcePath = sourcePath
    this.videoDir = videoDir
    this.slug = slug
  }

  // ── Computed Paths ─────────────────────────────────────────────────────────

  /** Path to the main video file: videoDir/{slug}.mp4 */
  get videoPath(): string {
    return join(this.videoDir, `${this.slug}.mp4`)
  }

  /** Path to the edited (silence-removed) video: videoDir/{slug}-edited.mp4 */
  get editedVideoPath(): string {
    return join(this.videoDir, `${this.slug}-edited.mp4`)
  }

  /** Path to the enhanced (visual overlays) video: videoDir/{slug}-enhanced.mp4 */
  get enhancedVideoPath(): string {
    return join(this.videoDir, `${this.slug}-enhanced.mp4`)
  }

  /** Path to the captioned video: videoDir/{slug}-captioned.mp4 */
  get captionedVideoPath(): string {
    return join(this.videoDir, `${this.slug}-captioned.mp4`)
  }

  /** Path to the fully produced video: videoDir/{slug}-produced.mp4 */
  get producedVideoPath(): string {
    return join(this.videoDir, `${this.slug}-produced.mp4`)
  }

  /** Path to a produced video for a specific aspect ratio: videoDir/{slug}-produced-{ar}.mp4 */
  producedVideoPathFor(aspectRatio: AspectRatio): string {
    const arSuffix = aspectRatio.replace(':', 'x') // '9:16' → '9x16'
    return join(this.videoDir, `${this.slug}-produced-${arSuffix}.mp4`)
  }

  /** Path to shorts metadata JSON */
  get shortsJsonPath(): string {
    return join(this.videoDir, 'shorts', 'shorts.json')
  }

  /** Path to shorts completion marker */
  private get shortsCompletionMarkerPath(): string {
    return join(this.videoDir, 'shorts', 'shorts.complete')
  }

  /** Path to medium clips metadata JSON */
  get mediumClipsJsonPath(): string {
    return join(this.videoDir, 'medium-clips', 'medium-clips.json')
  }

  /** Path to medium clips completion marker */
  private get mediumClipsCompletionMarkerPath(): string {
    return join(this.videoDir, 'medium-clips', 'medium-clips.complete')
  }

  // chaptersJsonPath is inherited from VideoAsset

  /** Path to summary README */
  get summaryPath(): string {
    return join(this.videoDir, 'README.md')
  }

  /** Path to summary metadata JSON */
  get summaryJsonPath(): string {
    return join(this.videoDir, 'summary.json')
  }

  /** Path to blog post */
  get blogPath(): string {
    return join(this.videoDir, 'blog-post.md')
  }

  /** Path to blog completion marker */
  get blogCompletionMarkerPath(): string {
    return join(this.videoDir, 'blog.complete')
  }

  /** Path to social posts completion marker */
  private get socialPostsCompletionMarkerPath(): string {
    return join(this.videoDir, 'social-posts', 'social-posts.complete')
  }

  /** Path to adjusted transcript (post silence-removal) */
  get adjustedTranscriptPath(): string {
    return join(this.videoDir, 'transcript-edited.json')
  }

  // ── Static Factory Methods ─────────────────────────────────────────────────

  /**
   * Ingest a source video into the recordings folder.
   * Copies the video, creates directory structure, and extracts metadata.
   *
   * @param sourcePath - Path to the source video file
   * @returns A new MainVideoAsset instance
   */
  static async ingest(sourcePath: string): Promise<MainVideoAsset> {
    const config = getConfig()
    const baseName = basename(sourcePath, extname(sourcePath))
    const slug = slugify(baseName, { lower: true })

    const videoDir = join(config.OUTPUT_DIR, slug)
    const thumbnailsDir = join(videoDir, 'thumbnails')
    const shortsDir = join(videoDir, 'shorts')
    const socialPostsDir = join(videoDir, 'social-posts')

    logger.info(`Ingesting video: ${sourcePath} → ${slug}`)

    // Clean stale artifacts if output folder already exists
    if (await fileExists(videoDir)) {
      logger.warn(`Output folder already exists, cleaning previous artifacts: ${videoDir}`)

      const subDirs = ['thumbnails', 'shorts', 'social-posts', 'chapters', 'medium-clips', 'captions', 'enhancements']
      // Also clean test script output directories ({slug}-enhance-test)
      const allEntries = await listDirectory(videoDir)
      for (const entry of allEntries) {
        if (entry.endsWith('-enhance-test')) {
          await removeDirectory(join(videoDir, entry), { recursive: true, force: true })
        }
      }
      for (const sub of subDirs) {
        await removeDirectory(join(videoDir, sub), { recursive: true, force: true })
      }

      const stalePatterns = [
        'transcript.json',
        'transcript-edited.json',
        'captions.srt',
        'captions.vtt',
        'captions.ass',
        'summary.md',
        'blog-post.md',
        'README.md',
        'clip-direction.md',
        'editorial-direction.md',
        'cost-report.md',
        'layout.json',
      ]
      for (const pattern of stalePatterns) {
        await removeFile(join(videoDir, pattern))
      }

      const files = await listDirectory(videoDir)
      for (const file of files) {
        if (file.endsWith('-edited.mp4') || file.endsWith('-enhanced.mp4') || file.endsWith('-captioned.mp4') || file.endsWith('-produced.mp4')) {
          await removeFile(join(videoDir, file))
        }
      }
    }

    // Create directory structure
    await ensureDirectory(videoDir)
    await ensureDirectory(thumbnailsDir)
    await ensureDirectory(shortsDir)
    await ensureDirectory(socialPostsDir)

    const destFilename = `${slug}.mp4`
    const destPath = join(videoDir, destFilename)

    // Copy video if needed
    let needsCopy = true
    try {
      const destStats = await getFileStats(destPath)
      const srcStats = await getFileStats(sourcePath)
      if (destStats.size === srcStats.size) {
        logger.info(`Video already copied (same size), skipping copy`)
        needsCopy = false
      }
    } catch {
      // Dest doesn't exist, need to copy
    }

    if (needsCopy) {
      await new Promise<void>((resolve, reject) => {
        const readStream = openReadStream(sourcePath)
        const writeStream = openWriteStream(destPath)
        readStream.on('error', reject)
        writeStream.on('error', reject)
        writeStream.on('finish', resolve)
        readStream.pipe(writeStream)
      })
      logger.info(`Copied video to ${destPath}`)
    }

    // Create the asset instance
    const asset = new MainVideoAsset(sourcePath, videoDir, slug)

    // Detect and save layout
    try {
      const layout = await asset.getLayout()
      logger.info(
        `Layout detected: webcam=${layout.webcam ? `${layout.webcam.position} (${layout.webcam.confidence})` : 'none'}`,
      )
    } catch (err) {
      logger.warn(`Layout detection failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    // Log metadata
    try {
      const metadata = await asset.getMetadata()
      const stats = await getFileStats(destPath)
      logger.info(`Video metadata: duration=${metadata.duration}s, size=${stats.size} bytes`)
    } catch (err) {
      logger.warn(`Metadata extraction failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    return asset
  }

  /**
   * Load an existing video from a recordings folder.
   *
   * @param videoDir - Path to the recordings/{slug}/ directory
   * @returns A MainVideoAsset instance
   * @throws Error if the directory or video file doesn't exist
   */
  static async load(videoDir: string): Promise<MainVideoAsset> {
    if (!(await fileExists(videoDir))) {
      throw new Error(`Video directory not found: ${videoDir}`)
    }

    // Derive slug from directory name
    const slug = basename(videoDir)
    const videoPath = join(videoDir, `${slug}.mp4`)

    if (!(await fileExists(videoPath))) {
      throw new Error(`Video file not found: ${videoPath}`)
    }

    // Use the video path as the source path for loaded assets
    return new MainVideoAsset(videoPath, videoDir, slug)
  }

  // ── Transcript Override ────────────────────────────────────────────────────

  /**
   * Get transcript. Loads from disk if available, otherwise generates via transcription service.
   *
   * @param opts - Options controlling generation behavior
   * @returns Transcript with segments and words
   */
  async getTranscript(opts?: AssetOptions): Promise<Transcript> {
    if (opts?.force) {
      this.cache.delete('transcript')
    }
    return this.cached('transcript', async () => {
      if (!opts?.force && await fileExists(this.transcriptPath)) {
        return readJsonFile<Transcript>(this.transcriptPath)
      }

      // Generate via transcription service
      const videoFile = await this.toVideoFile()
      const transcript = await transcribeVideo(videoFile)
      logger.info(`Generated transcript: ${transcript.segments.length} segments`)
      return transcript
    })
  }

  // ── Video Variants (Lazy-Load) ─────────────────────────────────────────────

  /**
   * Get the original video path. Always exists after ingestion.
   */
  async getOriginalVideo(): Promise<string> {
    if (!(await fileExists(this.videoPath))) {
      throw new Error(`Original video not found: ${this.videoPath}`)
    }
    return this.videoPath
  }

  /**
   * Get the edited (silence-removed) video.
   * If not already generated, runs silence removal.
   *
   * @param opts - Options controlling generation
   * @returns Path to the edited video
   */
  async getEditedVideo(opts?: AssetOptions): Promise<string> {
    // Check if edited video already exists
    if (!opts?.force && (await fileExists(this.editedVideoPath))) {
      return this.editedVideoPath
    }

    // Generate via silence removal agent
    const transcript = await this.getTranscript()
    const videoFile = await this.toVideoFile()
    const result = await removeDeadSilence(videoFile, transcript)

    if (result.wasEdited) {
      logger.info(`Silence removal completed: ${result.removals.length} segments removed`)
      return result.editedPath
    }

    logger.info('No silence removed, using original video')
    return this.videoPath
  }

  /**
   * Get the enhanced (visual overlays) video.
   * If not already generated, runs the visual enhancement stage.
   * Falls back to the edited video if enhancement is skipped or finds no opportunities.
   *
   * @param opts - Options controlling generation
   * @returns Path to the enhanced or edited video
   */
  async getEnhancedVideo(opts?: AssetOptions): Promise<string> {
    // Check if enhanced video already exists
    if (!opts?.force && (await fileExists(this.enhancedVideoPath))) {
      return this.enhancedVideoPath
    }

    const config = getConfig()
    if (config.SKIP_VISUAL_ENHANCEMENT) {
      return this.getEditedVideo(opts)
    }

    // Get edited video and transcript
    const editedPath = await this.getEditedVideo(opts)
    const transcript = await this.getTranscript()
    const videoFile = await this.toVideoFile()

    // Run visual enhancement
    const result = await enhanceVideo(editedPath, transcript, videoFile)

    if (result) {
      logger.info(`Visual enhancement completed: ${result.overlays.length} overlays composited`)
      return result.enhancedVideoPath
    }

    logger.info('No visual enhancements generated, using edited video')
    return editedPath
  }

  /**
   * Get the captioned video.
   * If not already generated, burns captions into the enhanced video.
   *
   * @param opts - Options controlling generation
   * @returns Path to the captioned video
   */
  async getCaptionedVideo(opts?: AssetOptions): Promise<string> {
    // Check if captioned video already exists
    if (!opts?.force && (await fileExists(this.captionedVideoPath))) {
      return this.captionedVideoPath
    }

    // Get enhanced video (includes editing + overlays) and captions
    const enhancedPath = await this.getEnhancedVideo(opts)
    const captions = await this.getCaptions()

    // Burn captions into video
    await burnCaptions(enhancedPath, captions.ass, this.captionedVideoPath)
    logger.info(`Captions burned into video: ${this.captionedVideoPath}`)
    return this.captionedVideoPath
  }

  /**
   * Get the fully produced video.
   * If not already generated, runs the ProducerAgent.
   *
   * @param opts - Options controlling generation
   * @param aspectRatio - Target aspect ratio (default: '16:9')
   * @returns Path to the produced video
   */
  async getProducedVideo(opts?: AssetOptions, aspectRatio: AspectRatio = '16:9'): Promise<string> {
    const outputPath = this.producedVideoPathFor(aspectRatio)

    // Check if produced video already exists
    if (!opts?.force && (await fileExists(outputPath))) {
      return outputPath
    }

    // Get required inputs - ensure captioned video exists first
    await this.getCaptionedVideo()

    // Load and run producer agent (video asset passed to constructor)
    const agent = new ProducerAgent(this, aspectRatio)

    const result = await agent.produce(outputPath)

    if (!result.success) {
      logger.warn(`Production failed: ${result.error}, falling back to captioned`)
      return this.captionedVideoPath
    }

    return outputPath
  }

  // ── Asset Implementation ───────────────────────────────────────────────────

  /**
   * Get the final result - the produced video path.
   */
  async getResult(opts?: AssetOptions): Promise<string> {
    return this.getProducedVideo(opts)
  }

  // ── Child Assets ───────────────────────────────────────────────────────────

  /** Directory containing shorts */
  private get shortsDir(): string {
    return join(this.videoDir, 'shorts')
  }

  /** Check if shorts generation is complete */
  private async isShortsComplete(): Promise<boolean> {
    return fileExists(this.shortsCompletionMarkerPath)
  }

  /** Mark shorts generation as complete */
  private async markShortsComplete(): Promise<void> {
    await writeTextFile(this.shortsCompletionMarkerPath, new Date().toISOString())
  }

  /** Clear shorts completion marker for regeneration */
  private async clearShortsCompletion(): Promise<void> {
    await removeFile(this.shortsCompletionMarkerPath)
  }

  /** Directory containing medium clips */
  private get mediumClipsDir(): string {
    return join(this.videoDir, 'medium-clips')
  }

  /** Check if medium clips generation is complete */
  private async isMediumClipsComplete(): Promise<boolean> {
    return fileExists(this.mediumClipsCompletionMarkerPath)
  }

  /** Mark medium clips generation as complete */
  private async markMediumClipsComplete(): Promise<void> {
    await writeTextFile(this.mediumClipsCompletionMarkerPath, new Date().toISOString())
  }

  /** Clear medium clips completion marker */
  private async clearMediumClipsCompletion(): Promise<void> {
    await removeFile(this.mediumClipsCompletionMarkerPath)
  }

  /** Load medium clips data from disk */
  private async loadMediumClipsFromDisk(): Promise<MediumClip[]> {
    if (await fileExists(this.mediumClipsJsonPath)) {
      const data = await readJsonFile<{ clips: MediumClip[] }>(this.mediumClipsJsonPath)
      return data.clips ?? []
    }
    return []
  }

  /** Directory containing social posts */
  private get socialPostsDir(): string {
    return join(this.videoDir, 'social-posts')
  }

  /** Check if social posts generation is complete */
  private async isSocialPostsComplete(): Promise<boolean> {
    return fileExists(this.socialPostsCompletionMarkerPath)
  }

  /** Mark social posts generation as complete */
  private async markSocialPostsComplete(): Promise<void> {
    await ensureDirectory(this.socialPostsDir)
    await writeTextFile(this.socialPostsCompletionMarkerPath, new Date().toISOString())
  }

  /** Clear social posts completion marker for regeneration */
  private async clearSocialPostsCompletion(): Promise<void> {
    if (await fileExists(this.socialPostsCompletionMarkerPath)) {
      await removeFile(this.socialPostsCompletionMarkerPath)
    }
    this.cache.delete('socialPosts')
  }

  /** Load social posts from disk by parsing markdown files */
  private async loadSocialPostsFromDisk(): Promise<SocialPost[]> {
    const posts: SocialPost[] = []
    const platforms = [Platform.TikTok, Platform.YouTube, Platform.Instagram, Platform.LinkedIn, Platform.X]

    for (const platform of platforms) {
      const filePath = join(this.socialPostsDir, `${platform.toLowerCase()}.md`)
      if (await fileExists(filePath)) {
        const content = await readTextFile(filePath)
        const post = this.parseSocialPostFile(content, platform, filePath)
        if (post) {
          posts.push(post)
        }
      }
    }

    return posts
  }

  /**
   * Parse a social post markdown file into a SocialPost object.
   *
   * @param content - Markdown file content with YAML frontmatter
   * @param platform - Target platform
   * @param filePath - Path to the file (for outputPath field)
   * @returns Parsed SocialPost or null if parsing fails
   */
  private parseSocialPostFile(content: string, platform: Platform, filePath: string): SocialPost | null {
    // Check for frontmatter delimiters
    if (!content.startsWith('---')) {
      return null
    }

    // Find closing delimiter
    const endIndex = content.indexOf('---', 3)
    if (endIndex === -1) {
      return null
    }

    const yamlContent = content.slice(3, endIndex).trim()
    const bodyContent = content.slice(endIndex + 3).trim()

    // Parse YAML frontmatter
    const hashtags: string[] = []
    const links: string[] = []
    let characterCount = bodyContent.length

    const lines = yamlContent.split('\n')
    let inHashtags = false
    let inLinks = false

    for (const line of lines) {
      const trimmed = line.trim()

      // Handle array items
      if (trimmed.startsWith('- ')) {
        if (inHashtags) {
          const tag = trimmed.slice(2).trim().replace(/^["']|["']$/g, '')
          if (tag) hashtags.push(tag)
        } else if (inLinks) {
          // Links can be in format: - url: "..." or just - "..."
          const urlMatch = trimmed.match(/url:\s*["']([^"']+)["']/)
          if (urlMatch) {
            links.push(urlMatch[1])
          }
        }
        continue
      }

      // Check for section starts
      const colonIndex = line.indexOf(':')
      if (colonIndex !== -1) {
        const key = line.slice(0, colonIndex).trim()
        const value = line.slice(colonIndex + 1).trim()

        inHashtags = false
        inLinks = false

        switch (key) {
          case 'hashtags':
            inHashtags = value === '' || value === '[]'
            if (value && value !== '[]') {
              // Inline array format not expected but handle it
              inHashtags = true
            }
            break
          case 'links':
            inLinks = value === '' || value === '[]'
            if (value && value !== '[]') {
              inLinks = true
            }
            break
          case 'characterCount':
            characterCount = parseInt(value, 10) || bodyContent.length
            break
        }
      }
    }

    return {
      platform,
      content: bodyContent,
      hashtags,
      links,
      characterCount,
      outputPath: filePath,
    }
  }

  /**
   * Get short clips for this video as ShortVideoAsset objects.
   * Uses completion marker pattern for idempotency.
   *
   * @param opts - Options controlling generation
   * @returns Array of ShortVideoAsset objects
   */
  async getShorts(opts?: AssetOptions): Promise<ShortVideoAsset[]> {
    if (opts?.force) {
      await this.clearShortsCompletion()
    }

    if (await this.isShortsComplete()) {
      const clips = await this.loadShortsFromDisk()
      return clips.map((clip) => new ShortVideoAsset(this, clip, this.shortsDir))
    }

    const clips = await this.generateShortsInternal()
    await this.markShortsComplete()
    return clips.map((clip) => new ShortVideoAsset(this, clip, this.shortsDir))
  }

  /** Load shorts data from disk */
  private async loadShortsFromDisk(): Promise<ShortClip[]> {
    if (await fileExists(this.shortsJsonPath)) {
      const data = await readJsonFile<{ shorts: ShortClip[] }>(this.shortsJsonPath)
      return data.shorts ?? []
    }
    return []
  }

  /**
   * Generate shorts via ShortsAgent.
   * Internal helper called when completion marker is absent.
   *
   * @returns Array of ShortClip objects
   */
  private async generateShortsInternal(): Promise<ShortClip[]> {
    const transcript = await this.getTranscript()
    const videoFile = await this.toVideoFile()
    const shorts = await generateShorts(videoFile, transcript)
    logger.info(`Generated ${shorts.length} short clips`)
    return shorts
  }

  /**
   * Get medium clips for this video as MediumClipAsset objects.
   * Uses completion marker pattern for idempotency.
   *
   * @param opts - Options controlling generation
   * @returns Array of MediumClipAsset objects
   */
  async getMediumClips(opts?: AssetOptions): Promise<MediumClipAsset[]> {
    if (opts?.force) {
      await this.clearMediumClipsCompletion()
    }

    if (await this.isMediumClipsComplete()) {
      const clips = await this.loadMediumClipsFromDisk()
      return clips.map((clip) => new MediumClipAsset(this, clip, this.mediumClipsDir))
    }

    const clips = await this.generateMediumClipsInternal()
    await this.markMediumClipsComplete()
    return clips.map((clip) => new MediumClipAsset(this, clip, this.mediumClipsDir))
  }

  /**
   * Generate medium clips via MediumVideoAgent.
   * Internal helper called when completion marker is absent.
   *
   * @returns Array of MediumClip objects
   */
  private async generateMediumClipsInternal(): Promise<MediumClip[]> {
    const transcript = await this.getTranscript()
    const videoFile = await this.toVideoFile()
    const clips = await generateMediumClips(videoFile, transcript)
    logger.info(`Generated ${clips.length} medium clips for ${this.slug}`)
    return clips
  }

  /**
   * Get social posts for this video.
   * Uses completion marker pattern for idempotency.
   * Loads from disk if available, otherwise generates via SocialMediaAgent.
   *
   * @param opts - Options controlling generation
   * @returns Array of SocialPost objects (one per platform)
   */
  async getSocialPosts(opts?: AssetOptions): Promise<SocialPost[]> {
    if (opts?.force) {
      await this.clearSocialPostsCompletion()
    }

    if (await this.isSocialPostsComplete()) {
      return this.loadSocialPostsFromDisk()
    }

    // Generate social posts using SocialMediaAgent
    const transcript = await this.getTranscript()
    const summary = await this.getSummary()
    const video = await this.toVideoFile()
    await ensureDirectory(this.socialPostsDir)
    const posts = await generateSocialPosts(video, transcript, summary, this.socialPostsDir)

    await this.markSocialPostsComplete()
    return posts
  }

  /**
   * Get the summary for this video.
   * Uses completion marker pattern for idempotency.
   * Loads from disk if available, otherwise generates via SummaryAgent.
   *
   * @param opts - Options controlling generation
   * @returns VideoSummary with title, overview, keyTopics, snapshots, and markdownPath
   */
  async getSummary(opts?: AssetOptions): Promise<VideoSummary> {
    if (opts?.force) {
      await this.clearSummaryCompletion()
    }

    if (await this.isSummaryComplete()) {
      return this.loadSummaryFromDisk()
    }

    // Generate summary using SummaryAgent
    const transcript = await this.getTranscript()
    const shorts = await this.getShorts().catch(() => [])
    const chapters = await this.getChapters().catch(() => [])
    // Convert ShortVideoAsset[] to ShortClip[]
    const shortClips = shorts.map((s) => s.clip)
    const summary = await this.generateSummaryInternal(transcript, shortClips, chapters)

    await this.markSummaryComplete()
    return summary
  }

  /**
   * Check if summary generation is complete.
   */
  private async isSummaryComplete(): Promise<boolean> {
    return (await fileExists(this.summaryJsonPath)) && (await fileExists(this.summaryPath))
  }

  /**
   * Mark summary as complete by ensuring JSON metadata exists.
   */
  private async markSummaryComplete(): Promise<void> {
    // No-op: summary.json is written during generation
  }

  /**
   * Clear summary completion marker to force regeneration.
   */
  private async clearSummaryCompletion(): Promise<void> {
    if (await fileExists(this.summaryJsonPath)) {
      await removeFile(this.summaryJsonPath)
    }
    if (await fileExists(this.summaryPath)) {
      await removeFile(this.summaryPath)
    }
    this.cache.delete('summary')
  }

  /**
   * Load summary from disk.
   * Reads the summary.json metadata file.
   */
  private async loadSummaryFromDisk(): Promise<VideoSummary> {
    const summary = await readJsonFile<VideoSummary>(this.summaryJsonPath)
    return summary
  }

  /**
   * Generate summary via SummaryAgent.
   * Internal helper called when completion marker is absent.
   */
  private async generateSummaryInternal(
    transcript: Transcript,
    shorts: ShortClip[],
    chapters: Chapter[],
  ): Promise<VideoSummary> {
    const video = await this.toVideoFile()
    const summary = await generateSummary(video, transcript, shorts, chapters)
    // Persist the VideoSummary metadata to JSON
    await writeJsonFile(this.summaryJsonPath, summary)
    logger.info(`Generated summary for ${this.slug}`)
    return summary
  }

  /**
   * Get the blog post content for this video.
   * Uses completion marker pattern for idempotency.
   * Loads from disk if available, otherwise generates via BlogAgent.
   *
   * @param opts - Options controlling generation
   * @returns Blog post markdown content string
   */
  async getBlog(opts?: AssetOptions): Promise<string> {
    if (opts?.force) {
      await this.clearBlogCompletion()
    }

    if (await this.isBlogComplete()) {
      return this.loadBlogFromDisk()
    }

    // Generate blog using BlogAgent
    const transcript = await this.getTranscript()
    const summary = await this.getSummary()
    const video = await this.toVideoFile()
    const blogContent = await generateBlogPost(video, transcript, summary)

    // Write to disk
    await writeTextFile(this.blogPath, blogContent)
    await this.markBlogComplete()

    return blogContent
  }

  /**
   * Check if blog generation is complete.
   */
  private async isBlogComplete(): Promise<boolean> {
    return fileExists(this.blogCompletionMarkerPath)
  }

  /**
   * Mark blog as complete.
   */
  private async markBlogComplete(): Promise<void> {
    await writeTextFile(this.blogCompletionMarkerPath, new Date().toISOString())
  }

  /**
   * Clear blog completion marker to force regeneration.
   */
  private async clearBlogCompletion(): Promise<void> {
    if (await fileExists(this.blogCompletionMarkerPath)) {
      await removeFile(this.blogCompletionMarkerPath)
    }
    if (await fileExists(this.blogPath)) {
      await removeFile(this.blogPath)
    }
  }

  /**
   * Load blog content from disk.
   */
  private async loadBlogFromDisk(): Promise<string> {
    return readTextFile(this.blogPath)
  }

  /**
   * Get chapters for this video.
   * Loads from disk if available (via base class), otherwise generates via ChapterAgent.
   *
   * @param opts - Options controlling generation
   * @returns Array of Chapter objects
   */
  override async getChapters(opts?: AssetOptions): Promise<Chapter[]> {
    // Try loading from disk first (base class handles caching + disk read)
    const diskChapters = await super.getChapters(opts)
    if (diskChapters.length > 0) {
      return diskChapters
    }

    // Generate via ChapterAgent and cache the result
    return this.cached('chapters', async () => {
      const transcript = await this.getTranscript()
      const videoFile = await this.toVideoFile()
      const chapters = await generateChapters(videoFile, transcript)
      logger.info(`Generated ${chapters.length} chapters`)
      return chapters
    })
  }

  // ── Text Assets ────────────────────────────────────────────────────────────

  /**
   * Get the summary README content.
   *
   * @returns Summary markdown content
   * @throws Error if summary doesn't exist
   */
  async getSummaryContent(): Promise<string> {
    if (!(await fileExists(this.summaryPath))) {
      throw new Error(`Summary not found at ${this.summaryPath}. Run the summary stage first.`)
    }
    return readTextFile(this.summaryPath)
  }

  /**
   * Get the blog post content.
   *
   * @returns Blog post markdown content
   * @throws Error if blog doesn't exist
   */
  async getBlogContent(): Promise<string> {
    if (!(await fileExists(this.blogPath))) {
      throw new Error(`Blog post not found at ${this.blogPath}. Run the blog stage first.`)
    }
    return readTextFile(this.blogPath)
  }

  // ── Transcript Access ──────────────────────────────────────────────────────

  /**
   * Get the adjusted transcript (post silence-removal).
   * Falls back to original transcript if adjusted version doesn't exist.
   */
  async getAdjustedTranscript(): Promise<Transcript> {
    if (await fileExists(this.adjustedTranscriptPath)) {
      return readJsonFile<Transcript>(this.adjustedTranscriptPath)
    }
    // Fall back to original transcript
    return this.getTranscript()
  }

  // ── VideoFile Conversion ───────────────────────────────────────────────────

  /**
   * Convert to VideoFile interface for compatibility with existing agents.
   */
  async toVideoFile(): Promise<VideoFile> {
    const metadata = await this.getMetadata()
    const stats = await getFileStats(this.videoPath)
    const layout = await this.getLayout().catch(() => undefined)

    return {
      originalPath: this.sourcePath,
      repoPath: this.videoPath,
      videoDir: this.videoDir,
      slug: this.slug,
      filename: `${this.slug}.mp4`,
      duration: metadata.duration,
      size: stats.size,
      createdAt: new Date(stats.mtime),
      layout,
    }
  }

  // ── Pipeline Stage Methods ─────────────────────────────────────────────────
  // Methods that wrap L4 agent/bridge calls for use by the L6 pipeline.
  // Each method accepts explicit parameters (no implicit caching) so the
  // pipeline can control data flow between stages.

  /**
   * Run silence removal via the ProducerAgent.
   * @returns ProduceResult with removals, keepSegments, and output path
   */
  async removeSilence(modelName?: string): Promise<ProduceResult> {
    const agent = new ProducerAgent(this, modelName)
    return agent.produce(this.editedVideoPath)
  }

  /**
   * Transcribe an edited video file (post silence-removal).
   * Creates a VideoFile pointing to the edited path and runs transcription.
   */
  async transcribeEditedVideo(editedVideoPath: string): Promise<Transcript> {
    const video = await this.toVideoFile()
    const editedVideo: VideoFile = { ...video, repoPath: editedVideoPath, filename: basename(editedVideoPath) }
    return transcribeVideo(editedVideo)
  }

  /**
   * Analyze edited video for clip direction suggestions via Gemini.
   */
  async analyzeClipDirection(videoPath: string, duration: number): Promise<string> {
    return analyzeVideoClipDirection(videoPath, duration)
  }

  /**
   * Generate social posts for a single short/medium clip.
   */
  async generateShortPostsData(
    short: ShortClip,
    transcript: Transcript,
    modelName?: string,
  ): Promise<SocialPost[]> {
    const video = await this.toVideoFile()
    return generateShortPosts(video, short, transcript, modelName)
  }

  /**
   * Generate social posts for a single medium clip.
   * Converts MediumClip to ShortClip format and generates posts,
   * then moves them to the medium clip's posts directory.
   */
  async generateMediumClipPostsData(
    clip: MediumClip,
    modelName?: string,
  ): Promise<SocialPost[]> {
    const transcript = await this.getAdjustedTranscript()
    const asShortClip: ShortClip = {
      id: clip.id,
      title: clip.title,
      slug: clip.slug,
      segments: clip.segments,
      totalDuration: clip.totalDuration,
      outputPath: clip.outputPath,
      captionedPath: clip.captionedPath,
      description: clip.description,
      tags: clip.tags,
    }
    const posts = await this.generateShortPostsData(asShortClip, transcript, modelName)

    // Move posts to medium-clips/{slug}/posts/
    const clipsDir = join(this.videoDir, 'medium-clips')
    const postsDir = join(clipsDir, clip.slug, 'posts')
    await ensureDirectory(postsDir)
    for (const post of posts) {
      const destPath = join(postsDir, basename(post.outputPath))
      await copyFile(post.outputPath, destPath)
      await removeFile(post.outputPath)
      post.outputPath = destPath
    }

    return posts
  }

  /**
   * Build the publish queue via the queue builder service.
   */
  private async buildPublishQueueData(
    shorts: ShortClip[],
    mediumClips: MediumClip[],
    socialPosts: SocialPost[],
    captionedVideoPath: string | undefined,
  ): Promise<QueueBuildResult> {
    const video = await this.toVideoFile()
    return buildPublishQueue(video, shorts, mediumClips, socialPosts, captionedVideoPath)
  }

  /**
   * Build the publish queue (simplified wrapper for pipeline).
   * Delegates to buildPublishQueueData with provided clip/post data.
   */
  async buildQueue(
    shorts: ShortClip[],
    mediumClips: MediumClip[],
    socialPosts: SocialPost[],
    captionedVideoPath: string | undefined,
  ): Promise<void> {
    await this.buildPublishQueueData(shorts, mediumClips, socialPosts, captionedVideoPath)
  }

  /**
   * Commit and push all generated assets via git.
   */
  async commitAndPushChanges(message?: string): Promise<void> {
    return commitAndPush(this.slug, message)
  }
}
