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
import { SocialPostAsset } from './SocialPostAsset.js'
import { SummaryAsset } from './SummaryAsset.js'
import { BlogAsset } from './BlogAsset.js'
import { join, basename, extname, dirname } from '../core/paths.js'
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
} from '../core/fileSystem.js'
import { slugify } from '../core/text.js'
import { ffprobe } from '../core/ffmpeg.js'
import {
  loadTranscription,
  loadSilenceRemovalAgent,
  loadCaptionBurning,
  loadShortsAgent,
  loadMediumVideoAgent,
  loadChapterAgent,
  loadProducerAgent,
  loadVisualEnhancement,
} from './loaders.js'
import { getConfig } from '../config/environment.js'
import logger from '../config/logger.js'
import {
  Platform,
} from '../types/index.js'
import type {
  ShortClip,
  MediumClip,
  Chapter,
  Transcript,
  VideoFile,
  VideoLayout,
  AspectRatio,
} from '../types/index.js'

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

  /** Path to medium clips metadata JSON */
  get mediumClipsJsonPath(): string {
    return join(this.videoDir, 'medium-clips', 'medium-clips.json')
  }

  // chaptersJsonPath is inherited from VideoAsset

  /** Path to summary README */
  get summaryPath(): string {
    return join(this.videoDir, 'README.md')
  }

  /** Path to blog post */
  get blogPath(): string {
    return join(this.videoDir, 'blog-post.md')
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
      const { transcribeVideo } = await loadTranscription()
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
    const { removeDeadSilence } = await loadSilenceRemovalAgent()
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
    const { enhanceVideo } = await loadVisualEnhancement()
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
    const { burnCaptions } = await loadCaptionBurning()
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
    const { ProducerAgent } = await loadProducerAgent()
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

  /** Directory containing medium clips */
  private get mediumClipsDir(): string {
    return join(this.videoDir, 'medium-clips')
  }

  /** Directory containing social posts */
  private get socialPostsDir(): string {
    return join(this.videoDir, 'social-posts')
  }

  /**
   * Get short clips for this video as ShortVideoAsset objects.
   * Loads clip data from disk if available, wraps each in ShortVideoAsset.
   *
   * @param opts - Options controlling generation
   * @returns Array of ShortVideoAsset objects
   */
  async getShorts(opts?: AssetOptions): Promise<ShortVideoAsset[]> {
    const clips = await this.loadOrGenerateShorts(opts)
    return clips.map((clip) => new ShortVideoAsset(this, clip, this.shortsDir))
  }

  /**
   * Load raw short clip data from disk or generate via ShortsAgent.
   *
   * @param opts - Options controlling generation
   * @returns Array of ShortClip objects
   */
  private async loadOrGenerateShorts(opts?: AssetOptions): Promise<ShortClip[]> {
    return this.cached('shortsData', async () => {
      // Check if shorts already exist on disk
      if (!opts?.force && await fileExists(this.shortsJsonPath)) {
        const data = await readJsonFile<{ shorts: ShortClip[] }>(this.shortsJsonPath)
        return data.shorts ?? []
      }

      // Check if individual short files exist in shorts directory
      if (!opts?.force && await fileExists(this.shortsDir)) {
        const files = await listDirectory(this.shortsDir)
        const mdFiles = files.filter((f) => f.endsWith('.md') && f !== 'README.md')
        if (mdFiles.length > 0) {
          // Parse shorts from individual markdown files
          // TODO: Implement parsing of individual short files
          logger.info(`Found ${mdFiles.length} short files, but parsing not yet implemented`)
        }
      }

      // Generate via ShortsAgent
      const { generateShorts } = await loadShortsAgent()
      const transcript = await this.getTranscript()
      const videoFile = await this.toVideoFile()
      const shorts = await generateShorts(videoFile, transcript)
      logger.info(`Generated ${shorts.length} short clips`)
      return shorts
    })
  }

  /**
   * Get medium clips for this video as MediumClipAsset objects.
   * Loads clip data from disk if available, wraps each in MediumClipAsset.
   *
   * @param opts - Options controlling generation
   * @returns Array of MediumClipAsset objects
   */
  async getMediumClips(opts?: AssetOptions): Promise<MediumClipAsset[]> {
    const clips = await this.loadOrGenerateMediumClips(opts)
    return clips.map((clip) => new MediumClipAsset(this, clip, this.mediumClipsDir))
  }

  /**
   * Load raw medium clip data from disk or generate via MediumVideoAgent.
   *
   * @param opts - Options controlling generation
   * @returns Array of MediumClip objects
   */
  private async loadOrGenerateMediumClips(opts?: AssetOptions): Promise<MediumClip[]> {
    return this.cached('mediumClipsData', async () => {
      // Check if medium clips already exist on disk
      if (await fileExists(this.mediumClipsJsonPath)) {
        const data = await readJsonFile<{ clips: MediumClip[] }>(this.mediumClipsJsonPath)
        return data.clips ?? []
      }

      // Check if individual clip files exist
      if (await fileExists(this.mediumClipsDir)) {
        const files = await listDirectory(this.mediumClipsDir)
        const mdFiles = files.filter((f) => f.endsWith('.md') && f !== 'README.md')
        if (mdFiles.length > 0) {
          logger.info(`Found ${mdFiles.length} medium clip files, but parsing not yet implemented`)
        }
      }

      // Generate via MediumVideoAgent
      const { generateMediumClips } = await loadMediumVideoAgent()
      const transcript = await this.getTranscript()
      const videoFile = await this.toVideoFile()
      const clips = await generateMediumClips(videoFile, transcript)
      logger.info(`Generated ${clips.length} medium clips for ${this.slug}`)
      return clips
    })
  }

  /**
   * Get social posts for this video as SocialPostAsset objects.
   * Returns one asset per platform.
   *
   * @returns Array of SocialPostAsset objects (one per platform)
   */
  async getSocialPosts(): Promise<SocialPostAsset[]> {
    const platforms: Platform[] = [
      Platform.TikTok,
      Platform.YouTube,
      Platform.Instagram,
      Platform.LinkedIn,
      Platform.X,
    ]
    return platforms.map((platform) => new SocialPostAsset(this, platform, this.socialPostsDir))
  }

  /**
   * Get the summary asset for this video.
   *
   * @returns SummaryAsset wrapping the README.md
   */
  async getSummary(): Promise<SummaryAsset> {
    return new SummaryAsset(this)
  }

  /**
   * Get the blog post asset for this video.
   *
   * @returns BlogAsset wrapping the blog-post.md
   */
  async getBlog(): Promise<BlogAsset> {
    return new BlogAsset(this)
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
      const { generateChapters } = await loadChapterAgent()
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
}
