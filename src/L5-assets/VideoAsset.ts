/**
 * VideoAsset Base Class
 *
 * Abstract base class for video assets (main video, shorts, medium clips).
 * Provides common functionality for transcripts, captions, layout detection.
 *
 * Implements the "check cache → check disk → generate → save" pattern for
 * all expensive operations like ffprobe metadata, layout detection, and
 * caption generation.
 */
import { Asset, AssetOptions } from './Asset.js'
import { join } from '../L1-infra/paths/paths.js'
import { fileExists, readJsonFile, readTextFile, writeJsonFile, ensureDirectory, writeTextFile } from '../L1-infra/fileSystem/fileSystem.js'
import { ffprobe } from '../L4-agents/videoServiceBridge.js'
import { generateSRT, generateVTT, generateStyledASS } from '../L0-pure/captions/captionGenerator.js'
import { loadFaceDetection, loadGeminiClient } from './loaders.js'
import type { Transcript, Chapter, VideoLayout, WebcamRegion, ScreenRegion } from '../L0-pure/types/index.js'

/**
 * Video file metadata extracted via ffprobe.
 */
export interface VideoMetadata {
  /** Duration in seconds */
  duration: number
  /** File size in bytes */
  size: number
  /** Video width in pixels */
  width: number
  /** Video height in pixels */
  height: number
}

/**
 * Paths to generated caption files.
 */
export interface CaptionFiles {
  /** Path to SRT subtitle file */
  srt: string
  /** Path to WebVTT subtitle file */
  vtt: string
  /** Path to ASS subtitle file (with styling) */
  ass: string
}

/**
 * Base class for video assets (main video, shorts, medium clips).
 * Provides common functionality for transcripts, captions, layout detection.
 *
 * Subclasses must implement the abstract properties that define where
 * the video and its assets are stored.
 */
export abstract class VideoAsset extends Asset<string> {
  /** Directory containing this video's assets */
  abstract readonly videoDir: string

  /** Path to the video file */
  abstract readonly videoPath: string

  /** URL-safe identifier */
  abstract readonly slug: string

  // ── Computed paths ─────────────────────────────────────────────────────────

  /** Path to transcript JSON file */
  get transcriptPath(): string {
    return join(this.videoDir, 'transcript.json')
  }

  /** Path to layout JSON file */
  get layoutPath(): string {
    return join(this.videoDir, 'layout.json')
  }

  /** Path to editorial direction markdown file */
  get editorialDirectionPath(): string {
    return join(this.videoDir, 'editorial-direction.md')
  }

  /** Path to clip direction markdown file */
  get clipDirectionPath(): string {
    return join(this.videoDir, 'clip-direction.md')
  }

  /** Directory containing caption files */
  get captionsDir(): string {
    return join(this.videoDir, 'captions')
  }

  /** Directory containing chapter files */
  get chaptersDir(): string {
    return join(this.videoDir, 'chapters')
  }

  /** Path to chapters JSON file */
  get chaptersJsonPath(): string {
    return join(this.chaptersDir, 'chapters.json')
  }

  // ── Metadata ───────────────────────────────────────────────────────────────

  /**
   * Get video metadata (duration, size, resolution).
   * Lazy-loads from ffprobe, caches in memory.
   *
   * @param opts - Options controlling generation behavior
   * @returns Video metadata
   */
  async getMetadata(opts?: AssetOptions): Promise<VideoMetadata> {
    if (opts?.force) {
      this.cache.delete('metadata')
    }
    return this.cached('metadata', async () => {
      const probeData = await ffprobe(this.videoPath)
      const videoStream = probeData.streams.find((s) => s.codec_type === 'video')

      return {
        duration: probeData.format.duration ?? 0,
        size: probeData.format.size ?? 0,
        width: videoStream?.width ?? 0,
        height: videoStream?.height ?? 0,
      }
    })
  }

  // ── Layout Detection ───────────────────────────────────────────────────────

  /**
   * Get video layout (webcam region, screen region).
   * Lazy-loads from layout.json or detects via face detection.
   *
   * @param opts - Options controlling generation behavior
   * @returns Video layout with webcam and screen regions
   */
  async getLayout(opts?: AssetOptions): Promise<VideoLayout> {
    if (opts?.force) {
      this.cache.delete('layout')
    }
    return this.cached('layout', async () => {
      // Check disk first
      if (!opts?.force && (await fileExists(this.layoutPath))) {
        return readJsonFile<VideoLayout>(this.layoutPath)
      }

      // Detect layout (lazy import to avoid config issues at module load)
      const { getVideoResolution, detectWebcamRegion } = await loadFaceDetection()
      const { width, height } = await getVideoResolution(this.videoPath)
      const webcam = await detectWebcamRegion(this.videoPath)

      // Compute screen region as inverse of webcam
      let screen: ScreenRegion | null = null
      if (webcam) {
        screen = this.computeScreenRegion(width, height, webcam)
      }

      const layout: VideoLayout = { width, height, webcam, screen }

      // Save to disk
      await writeJsonFile(this.layoutPath, layout)

      return layout
    })
  }

  /**
   * Shortcut to get webcam region.
   *
   * @returns Webcam region if detected, null otherwise
   */
  async getWebcamRegion(): Promise<WebcamRegion | null> {
    const layout = await this.getLayout()
    return layout.webcam
  }

  /**
   * Shortcut to get screen region.
   *
   * @returns Screen region (area not occupied by webcam), null if no webcam
   */
  async getScreenRegion(): Promise<ScreenRegion | null> {
    const layout = await this.getLayout()
    return layout.screen
  }

  /**
   * Compute the screen region as the area not occupied by the webcam.
   * For corner webcams, this is the full frame minus the webcam overlay.
   */
  private computeScreenRegion(
    width: number,
    height: number,
    webcam: WebcamRegion,
  ): ScreenRegion {
    // For simplicity, treat the entire frame as the screen region
    // (the webcam is an overlay, not a separate region)
    // More sophisticated layouts could crop the webcam out
    return { x: 0, y: 0, width, height }
  }

  // ── Editorial Direction ────────────────────────────────────────────────────

  /**
   * Get AI-generated editorial direction from Gemini video analysis.
   * Lazy-loads from editorial-direction.json or calls Gemini API.
   *
   * Returns null if GEMINI_API_KEY is not configured (optional feature).
   *
   * @param opts - Options controlling generation behavior
   * @returns Editorial direction as markdown text
   */
  async getEditorialDirection(opts?: AssetOptions): Promise<string | null> {
    if (opts?.force) {
      this.cache.delete('editorialDirection')
    }
    return this.cached('editorialDirection', async () => {
      // Check disk first
      if (!opts?.force && (await fileExists(this.editorialDirectionPath))) {
        return readTextFile(this.editorialDirectionPath)
      }

      // Check if Gemini is configured
      const { getConfig } = await import('../L1-infra/config/environment.js')
      const config = getConfig()
      if (!config.GEMINI_API_KEY) {
        return null
      }

      // Analyze video via Gemini
      const { analyzeVideoEditorial } = await loadGeminiClient()
      const metadata = await this.getMetadata()
      const direction = await analyzeVideoEditorial(
        this.videoPath,
        metadata.duration,
      )

      // Save to disk as markdown
      await writeTextFile(this.editorialDirectionPath, direction)

      return direction
    })
  }

  // ── Clip Direction ──────────────────────────────────────────────────────────

  /**
   * Get AI-generated clip direction from Gemini video analysis (pass 2).
   * Runs on the cleaned video to provide detailed direction for shorts
   * and medium clip extraction.
   *
   * Returns null if GEMINI_API_KEY is not configured (optional feature).
   *
   * @param opts - Options controlling generation behavior
   * @returns Clip direction as markdown text
   */
  async getClipDirection(opts?: AssetOptions): Promise<string | null> {
    if (opts?.force) {
      this.cache.delete('clipDirection')
    }
    return this.cached('clipDirection', async () => {
      // Check disk first
      if (!opts?.force && (await fileExists(this.clipDirectionPath))) {
        return readTextFile(this.clipDirectionPath)
      }

      // Check if Gemini is configured
      const { getConfig } = await import('../L1-infra/config/environment.js')
      const config = getConfig()
      if (!config.GEMINI_API_KEY) {
        return null
      }

      // Analyze video via Gemini
      const { analyzeVideoClipDirection } = await loadGeminiClient()
      const metadata = await this.getMetadata()
      const direction = await analyzeVideoClipDirection(
        this.videoPath,
        metadata.duration,
      )

      // Save to disk as markdown
      await writeTextFile(this.clipDirectionPath, direction)

      return direction
    })
  }

  // ── Transcript ─────────────────────────────────────────────────────────────

  /**
   * Get transcript. Lazy-loads from disk.
   * Subclasses may override to return adjusted transcript (e.g., after silence removal).
   *
   * Note: Actual transcription via Whisper is handled by the pipeline's
   * transcription stage. This method loads the saved result.
   *
   * @param opts - Options controlling generation behavior
   * @returns Transcript with segments and words
   * @throws Error if transcript doesn't exist and force is not set
   */
  async getTranscript(opts?: AssetOptions): Promise<Transcript> {
    if (opts?.force) {
      this.cache.delete('transcript')
    }
    return this.cached('transcript', async () => {
      if (await fileExists(this.transcriptPath)) {
        return readJsonFile<Transcript>(this.transcriptPath)
      }

      // TODO: Consider integrating transcribeVideo() here for full lazy-load support
      // For now, expect the transcript to be pre-generated by the pipeline
      throw new Error(
        `Transcript not found at ${this.transcriptPath}. ` +
          `Run the transcription stage first.`,
      )
    })
  }

  // ── Chapters ───────────────────────────────────────────────────────────────

  /**
   * Get chapters. Lazy-loads from disk.
   * Subclasses may override to generate chapters if not found (e.g., via ChapterAgent).
   *
   * @param opts - Options controlling generation behavior
   * @returns Array of chapters, empty if none found on disk
   */
  async getChapters(opts?: AssetOptions): Promise<Chapter[]> {
    if (opts?.force) {
      this.cache.delete('chapters')
    }
    return this.cached('chapters', async () => {
      if (!opts?.force && (await fileExists(this.chaptersJsonPath))) {
        const data = await readJsonFile<{ chapters: Chapter[] }>(this.chaptersJsonPath)
        return data.chapters ?? []
      }
      return []
    })
  }

  // ── Captions ───────────────────────────────────────────────────────────────

  /**
   * Get caption files (SRT, VTT, ASS).
   * Lazy-generates from transcript if needed.
   *
   * @param opts - Options controlling generation behavior
   * @returns Paths to caption files
   */
  async getCaptions(opts?: AssetOptions): Promise<CaptionFiles> {
    if (opts?.force) {
      this.cache.delete('captions')
    }
    return this.cached('captions', async () => {
      const srtPath = join(this.captionsDir, 'captions.srt')
      const vttPath = join(this.captionsDir, 'captions.vtt')
      const assPath = join(this.captionsDir, 'captions.ass')

      // Check if all caption files exist
      const [srtExists, vttExists, assExists] = await Promise.all([
        fileExists(srtPath),
        fileExists(vttPath),
        fileExists(assPath),
      ])

      if (!opts?.force && srtExists && vttExists && assExists) {
        return { srt: srtPath, vtt: vttPath, ass: assPath }
      }

      // Generate captions from transcript
      const transcript = await this.getTranscript()

      await ensureDirectory(this.captionsDir)

      const srt = generateSRT(transcript)
      const vtt = generateVTT(transcript)
      const ass = generateStyledASS(transcript)

      await Promise.all([
        writeTextFile(srtPath, srt),
        writeTextFile(vttPath, vtt),
        writeTextFile(assPath, ass),
      ])

      return { srt: srtPath, vtt: vttPath, ass: assPath }
    })
  }

  // ── Asset Implementation ───────────────────────────────────────────────────

  /**
   * Check if the video file exists.
   */
  async exists(): Promise<boolean> {
    return fileExists(this.videoPath)
  }

  /**
   * Get the video file path (the primary "result" of this asset).
   */
  async getResult(opts?: AssetOptions): Promise<string> {
    if (!(await this.exists())) {
      throw new Error(`Video not found at ${this.videoPath}`)
    }
    return this.videoPath
  }
}
