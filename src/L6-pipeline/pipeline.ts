import { join, basename } from '../L1-infra/paths/paths.js'
import { writeTextFile } from '../L1-infra/fileSystem/fileSystem.js'
import logger, { pushPipe, popPipe } from '../L1-infra/logger/configLogger'
import { getConfig } from '../L1-infra/config/environment'
import { MainVideoAsset } from '../L5-assets/MainVideoAsset.js'
import { costTracker, markPending, markProcessing, markCompleted, markFailed } from '../L5-assets/pipelineServices.js'
import type { CostReport } from '../L5-assets/pipelineServices.js'
import type {
  Transcript,
  VideoSummary,
  ShortClip,
  MediumClip,
  SocialPost,
  StageResult,
  PipelineResult,
  PipelineStage,
  Chapter,
} from '../L0-pure/types/index'
import { PipelineStage as Stage } from '../L0-pure/types/index'
import type { ShortVideoAsset } from '../L5-assets/ShortVideoAsset.js'
import type { MediumClipAsset } from '../L5-assets/MediumClipAsset.js'
import type { CaptionFiles } from '../L5-assets/VideoAsset.js'

/**
 * Execute a single pipeline stage with error isolation and timing.
 *
 * ### Stage contract
 * - Each stage is wrapped in a try/catch so a failure **does not abort** the
 *   pipeline. Subsequent stages proceed with whatever data is available.
 * - Returns `undefined` on failure (callers must null-check before using the result).
 * - Records success/failure, error message, and wall-clock duration in `stageResults`
 *   for the pipeline summary.
 *
 * This design lets the pipeline produce partial results — e.g. if shorts
 * generation fails, the summary and social posts can still be generated
 * from the transcript.
 *
 * @param stageName - Enum value identifying the stage (used in logs and results)
 * @param fn - Async function that performs the stage's work
 * @param stageResults - Mutable array that accumulates per-stage outcome records
 * @returns The stage result on success, or `undefined` on failure
 */
export async function runStage<T>(
  stageName: PipelineStage,
  fn: () => Promise<T>,
  stageResults: StageResult[],
): Promise<T | undefined> {
  const start = Date.now()
  try {
    const result = await fn()
    const duration = Date.now() - start
    stageResults.push({ stage: stageName, success: true, duration })
    logger.info(`Stage ${stageName} completed in ${duration}ms`)
    return result
  } catch (err: unknown) {
    const duration = Date.now() - start
    const message = err instanceof Error ? err.message : String(err)
    stageResults.push({ stage: stageName, success: false, error: message, duration })
    logger.error(`Stage ${stageName} failed after ${duration}ms: ${message}`)
    return undefined
  }
}

/**
 * Adjust transcript timestamps to account for removed silence segments.
 * Shifts all timestamps by subtracting the cumulative removed duration before each point.
 */
export function adjustTranscript(
  transcript: Transcript,
  removals: { start: number; end: number }[],
): Transcript {
  const sorted = [...removals].sort((a, b) => a.start - b.start)

  function adjustTime(t: number): number {
    let offset = 0
    for (const r of sorted) {
      if (t <= r.start) break
      if (t >= r.end) {
        offset += r.end - r.start
      } else {
        // timestamp is inside a removed region — snap to removal start
        offset += t - r.start
      }
    }
    return t - offset
  }

  return {
    ...transcript,
    duration: adjustTime(transcript.duration),
    segments: transcript.segments
      .filter(seg => !sorted.some(r => seg.start >= r.start && seg.end <= r.end))
      .map(seg => ({
        ...seg,
        start: adjustTime(seg.start),
        end: adjustTime(seg.end),
        words: seg.words
          .filter(w => !sorted.some(r => w.start >= r.start && w.end <= r.end))
          .map(w => ({
            ...w,
            start: adjustTime(w.start),
            end: adjustTime(w.end),
          })),
      })),
    words: transcript.words
      .filter(w => !sorted.some(r => w.start >= r.start && w.end <= r.end))
      .map(w => ({
        ...w,
        start: adjustTime(w.start),
        end: adjustTime(w.end),
      })),
  }
}

/**
 * Run the full video processing pipeline.
 *
 * ### Stage flow
 * Each asset method (getTranscript, getEditedVideo, etc.) handles its own:
 * - Disk cache check (load from file if exists)
 * - Generation (call agent/service if needed)
 * - File writing (save result to disk)
 *
 * The pipeline orchestrates the order and provides timing/error isolation via runStage().
 *
 * ### Why failures don't abort
 * Each stage runs through {@link runStage} which catches errors. This means a
 * transcription failure still lets git-push run (committing whatever was produced),
 * and a shorts failure doesn't block summary generation.
 */
export async function processVideo(videoPath: string): Promise<PipelineResult> {
  const pipelineStart = Date.now()
  const stageResults: StageResult[] = []
  const cfg = getConfig()

  costTracker.reset()

  // Helper: set cost-tracking stage before running
  function trackStage<T>(stage: PipelineStage, fn: () => Promise<T>): Promise<T | undefined> {
    costTracker.setStage(stage)
    return runStage(stage, fn, stageResults)
  }

  logger.info(`Pipeline starting for: ${videoPath}`)

  // 1. Ingestion — required for all subsequent stages
  const asset = await trackStage<MainVideoAsset>(Stage.Ingestion, () => MainVideoAsset.ingest(videoPath))
  if (!asset) {
    const totalDuration = Date.now() - pipelineStart
    logger.error('Ingestion failed — cannot proceed without video metadata')
    return {
      video: { originalPath: videoPath, repoPath: '', videoDir: '', slug: '', filename: '', duration: 0, size: 0, createdAt: new Date() },
      transcript: undefined,
      editedVideoPath: undefined,
      captions: undefined,
      captionedVideoPath: undefined,
      summary: undefined,
      shorts: [],
      mediumClips: [],
      socialPosts: [],
      blogPost: undefined,
      stageResults,
      totalDuration,
    }
  }

  const video = await asset.toVideoFile()
  pushPipe(video.videoDir)

  try {
    // 2. Transcription — asset handles disk check + Whisper call + file write
    const transcript = await trackStage<Transcript>(Stage.Transcription, () => asset.getTranscript())

    // 3. Silence Removal — asset handles edited video generation
    let editedVideoPath: string | undefined
    if (!cfg.SKIP_SILENCE_REMOVAL) {
      editedVideoPath = await trackStage<string>(Stage.SilenceRemoval, () => asset.getEditedVideo())
    }

    // 3.5. Visual Enhancement — asset handles overlay generation + compositing
    let enhancedVideoPath: string | undefined
    if (!cfg.SKIP_VISUAL_ENHANCEMENT) {
      enhancedVideoPath = await trackStage<string>(Stage.VisualEnhancement, () => asset.getEnhancedVideo())
    }

    // 4. Captions — asset handles transcript → SRT/VTT/ASS generation
    let captions: CaptionFiles | undefined
    if (!cfg.SKIP_CAPTIONS) {
      captions = await trackStage<CaptionFiles>(Stage.Captions, () => asset.getCaptions())
    }

    // 5. Caption Burn — asset handles burning captions into video
    let captionedVideoPath: string | undefined
    if (!cfg.SKIP_CAPTIONS) {
      captionedVideoPath = await trackStage<string>(Stage.CaptionBurn, () => asset.getCaptionedVideo())
    }

    // 6. Shorts — asset handles clip planning, extraction, caption burning
    let shorts: ShortClip[] = []
    if (!cfg.SKIP_SHORTS) {
      const shortAssets = await trackStage<ShortVideoAsset[]>(Stage.Shorts, () => asset.getShorts()) ?? []
      shorts = shortAssets.map(s => s.clip)
    }

    // 7. Medium Clips — asset handles clip planning, extraction, transitions
    let mediumClips: MediumClip[] = []
    if (!cfg.SKIP_MEDIUM_CLIPS) {
      const mediumAssets = await trackStage<MediumClipAsset[]>(Stage.MediumClips, () => asset.getMediumClips()) ?? []
      mediumClips = mediumAssets.map(m => m.clip)
    }

    // 8. Chapters — asset handles topic boundary detection
    const chapters = await trackStage<Chapter[]>(Stage.Chapters, () => asset.getChapters())

    // 9. Summary — asset handles README generation (after shorts/chapters for references)
    const summary = await trackStage<VideoSummary>(Stage.Summary, () => asset.getSummary())

    // 10. Social Media — asset handles platform-specific post generation
    let socialPosts: SocialPost[] = []
    if (!cfg.SKIP_SOCIAL) {
      const mainPosts = await trackStage<SocialPost[]>(Stage.SocialMedia, () => asset.getSocialPosts()) ?? []
      socialPosts.push(...mainPosts)

      // 11. Short Posts — generate social posts for each short clip
      if (shorts.length > 0) {
        await trackStage<void>(Stage.ShortPosts, async () => {
          for (const short of shorts) {
            const posts = await asset.generateShortPostsData(short, await asset.getTranscript())
            socialPosts.push(...posts)
          }
        })
      }

      // 12. Medium Clip Posts — generate social posts for each medium clip
      if (mediumClips.length > 0) {
        await trackStage<void>(Stage.MediumClipPosts, async () => {
          for (const clip of mediumClips) {
            const posts = await asset.generateMediumClipPostsData(clip)
            socialPosts.push(...posts)
          }
        })
      }
    }

    // 13. Queue Build — asset handles publish-queue/ population
    if (!cfg.SKIP_SOCIAL_PUBLISH && socialPosts.length > 0) {
      await trackStage<void>(Stage.QueueBuild, () => asset.buildQueue(shorts, mediumClips, socialPosts, captionedVideoPath))
    }

    // 14. Blog — asset handles blog post generation
    const blogPost = await trackStage<string>(Stage.Blog, () => asset.getBlog())

    // 15. Git — asset handles commit and push
    if (!cfg.SKIP_GIT) {
      await trackStage<void>(Stage.GitPush, () => asset.commitAndPushChanges())
    }

    const totalDuration = Date.now() - pipelineStart

    // Cost tracking report
    const report = costTracker.getReport()
    if (report.records.length > 0) {
      logger.info(costTracker.formatReport())
      const costMd = generateCostMarkdown(report)
      const costPath = join(video.videoDir, 'cost-report.md')
      await writeTextFile(costPath, costMd)
      logger.info(`Cost report saved: ${costPath}`)
    }

    logger.info(`Pipeline completed in ${totalDuration}ms`)

    return {
      video,
      transcript,
      editedVideoPath,
      enhancedVideoPath,
      captions: captions ? [captions.srt, captions.vtt, captions.ass] : undefined,
      captionedVideoPath,
      summary,
      chapters,
      shorts,
      mediumClips,
      socialPosts,
      blogPost,
      stageResults,
      totalDuration,
    }
  } finally {
    popPipe()
  }
}

function generateCostMarkdown(report: CostReport): string {
  let md = '# Pipeline Cost Report\n\n'
  md += `| Metric | Value |\n|--------|-------|\n`
  md += `| Total Cost | $${report.totalCostUSD.toFixed(4)} USD |\n`
  if (report.totalPRUs > 0) md += `| Total PRUs | ${report.totalPRUs} |\n`
  md += `| Input Tokens | ${report.totalTokens.input.toLocaleString()} |\n`
  md += `| Output Tokens | ${report.totalTokens.output.toLocaleString()} |\n`
  md += `| LLM Calls | ${report.records.length} |\n`
  if (report.totalServiceCostUSD > 0) md += `| Service Costs | $${report.totalServiceCostUSD.toFixed(4)} USD |\n`
  md += '\n'

  if (Object.keys(report.byAgent).length > 0) {
    md += '## By Agent\n\n| Agent | Cost | PRUs | Calls |\n|-------|------|------|-------|\n'
    for (const [agent, data] of Object.entries(report.byAgent)) {
      md += `| ${agent} | $${data.costUSD.toFixed(4)} | ${data.prus} | ${data.calls} |\n`
    }
    md += '\n'
  }

  if (Object.keys(report.byModel).length > 1) {
    md += '## By Model\n\n| Model | Cost | PRUs | Calls |\n|-------|------|------|-------|\n'
    for (const [model, data] of Object.entries(report.byModel)) {
      md += `| ${model} | $${data.costUSD.toFixed(4)} | ${data.prus} | ${data.calls} |\n`
    }
    md += '\n'
  }

  if (Object.keys(report.byService).length > 0) {
    md += '## By Service\n\n| Service | Cost | Calls |\n|---------|------|-------|\n'
    for (const [service, data] of Object.entries(report.byService)) {
      md += `| ${service} | $${data.costUSD.toFixed(4)} | ${data.calls} |\n`
    }
    md += '\n'
  }

  return md
}

export async function processVideoSafe(videoPath: string): Promise<PipelineResult | null> {
  // Derive slug from filename for state tracking (same logic as MainVideoAsset.ingest)
  const filename = basename(videoPath)
  const slug = filename.replace(/\.(mp4|mov|webm|avi|mkv)$/i, '')
  await markPending(slug, videoPath)
  await markProcessing(slug)

  try {
    const result = await processVideo(videoPath)
    await markCompleted(slug)
    return result
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(`Pipeline failed with uncaught error: ${message}`)
    await markFailed(slug, message)
    return null
  }
}
