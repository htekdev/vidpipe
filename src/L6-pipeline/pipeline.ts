import { join, dirname, basename } from '../L1-infra/paths/paths.js'
import { ensureDirectory, writeJsonFile, writeTextFile, copyFile, removeFile, fileExists, readTextFile, readJsonFile } from '../L1-infra/fileSystem/fileSystem.js'
import logger, { pushPipe, popPipe } from '../L1-infra/logger/configLogger'
import { getConfig } from '../L1-infra/config/environment'
import { MainVideoAsset } from '../L5-assets/MainVideoAsset.js'
import { costTracker, markPending, markProcessing, markCompleted, markFailed } from '../L5-assets/pipelineServices.js'
import { enhanceVideo } from './stages/visualEnhancement.js'
import { getModelForAgent } from '../L1-infra/config/modelConfig.js'
import type { CostReport, QueueBuildResult } from '../L5-assets/pipelineServices.js'
import type { ProduceResult } from '../L4-agents/ProducerAgent.js'
import type {
  VideoFile,
  Transcript,
  VideoSummary,
  ShortClip,
  MediumClip,
  SocialPost,
  StageResult,
  PipelineResult,
  PipelineStage,
  Chapter,
  VisualEnhancementResult,
  VideoLayout,
} from '../L0-pure/types/index'
import { PipelineStage as Stage } from '../L0-pure/types/index'

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
 * ### Stage ordering and data flow
 * 1. **Ingest** — extracts metadata (slug, duration, paths). Required; aborts if failed.
 * 2. **Transcribe** — Whisper transcription with word-level timestamps.
 * 3. **Video cleaning** — ProducerAgent trims dead air / bad segments and adjusts
 *    the transcript timestamps accordingly. Produces an `adjustedTranscript` for captions.
 * 4. **Captions** — generates SRT/VTT/ASS files from the (adjusted) transcript.
 * 5. **Caption burn** — renders captions into the video using FFmpeg. Prefers a
 *    single-pass approach (silence removal + captions in one encode) when possible.
 * 6. **Shorts** — AI-selected short clips. Uses the **original** transcript because
 *    clips are cut from the original (unedited) video.
 * 7. **Medium clips** — longer AI-selected clips (same original-transcript reasoning).
 * 8. **Chapters** — topic-boundary detection for YouTube chapters.
 * 9. **Summary** — README generation (runs after shorts/chapters so it can reference them).
 * 10–12. **Social posts** — platform-specific posts for the full video and each clip.
 * 13. **Queue build** — populates publish-queue/ for review before publishing.
 * 14. **Blog** — long-form blog post from transcript + summary.
 * 15. **Git push** — commits all generated assets and pushes.
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
  const videoAsset = await trackStage<MainVideoAsset>(Stage.Ingestion, () => MainVideoAsset.ingest(videoPath))
  if (!videoAsset) {
    const totalDuration = Date.now() - pipelineStart
    logger.error('Ingestion failed — cannot proceed without video metadata')
    return { video: { originalPath: videoPath, repoPath: '', videoDir: '', slug: '', filename: '', duration: 0, size: 0, createdAt: new Date() }, transcript: undefined, editedVideoPath: undefined, captions: undefined, captionedVideoPath: undefined, summary: undefined, shorts: [], mediumClips: [], socialPosts: [], blogPost: undefined, stageResults, totalDuration }
  }

  // Convert to VideoFile for backward compatibility
  const video = await videoAsset.toVideoFile()

  pushPipe(video.videoDir)
  try {
  // 2. Transcription
  let transcript: Transcript | undefined
  transcript = await trackStage<Transcript>(Stage.Transcription, () => videoAsset.getTranscript())

  // 3. Video Cleaning (ProducerAgent-based)
  let editedVideoPath: string | undefined
  let adjustedTranscript: Transcript | undefined
  let cleaningKeepSegments: { start: number; end: number }[] | undefined

  if (transcript && !cfg.SKIP_SILENCE_REMOVAL) {
    // Trigger Gemini editorial direction (cached for ProducerAgent use)
    await videoAsset.getEditorialDirection().catch(err => {
      logger.warn(`[Pipeline] Editorial direction unavailable: ${err instanceof Error ? err.message : String(err)}`)
    })

    const cleaningResult = await trackStage<ProduceResult>(
      Stage.SilenceRemoval,
      () => videoAsset.removeSilence(getModelForAgent('ProducerAgent')),
    )

    if (cleaningResult && cleaningResult.success && cleaningResult.removals.length > 0) {
      editedVideoPath = cleaningResult.outputPath
      cleaningKeepSegments = cleaningResult.keepSegments

      // Transcribe the edited video fresh — guaranteed accurate timestamps
      adjustedTranscript = await trackStage<Transcript>(
        Stage.Transcription,
        () => videoAsset.transcribeEditedVideo(editedVideoPath!),
      ) ?? undefined

      if (adjustedTranscript) {
        const totalRemoved = cleaningResult.removals.reduce((sum, r) => sum + (r.end - r.start), 0)
        logger.info(`[Pipeline] Video cleaning: original=${transcript.duration.toFixed(1)}s, removed=${totalRemoved.toFixed(1)}s, edited=${adjustedTranscript.duration.toFixed(1)}s`)

        await writeJsonFile(
          join(video.videoDir, 'transcript-edited.json'),
          adjustedTranscript,
        )
      }

      await writeJsonFile(
        join(video.videoDir, 'producer-plan.json'),
        { removals: cleaningResult.removals, keepSegments: cleaningResult.keepSegments, editCount: cleaningResult.editCount },
      )
    }
  }

  // Gemini Pass 2: Analyze cleaned video for clip direction
  // This provides short/medium clip suggestions to downstream agents
  if (editedVideoPath && !cfg.SKIP_SHORTS) {
    try {
      if (cfg.GEMINI_API_KEY) {
        logger.info('[Pipeline] Running Gemini Pass 2: clip direction analysis on cleaned video')
        const metadata = await videoAsset.getMetadata()
        const clipDirection = await videoAsset.analyzeClipDirection(editedVideoPath, metadata.duration)
        await writeTextFile(join(video.videoDir, 'clip-direction.md'), clipDirection)
        logger.info(`[Pipeline] Clip direction saved (${clipDirection.length} chars)`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn(`[Pipeline] Gemini clip direction failed (non-fatal): ${msg}`)
    }
  }

  // Use adjusted transcript for captions (if silence was removed), original otherwise
  const captionTranscript = adjustedTranscript ?? transcript

  // 3.5. Visual Enhancement — AI-generated image overlays
  let enhancedVideoPath: string | undefined
  if (!cfg.SKIP_VISUAL_ENHANCEMENT && captionTranscript) {
    const videoToEnhance = editedVideoPath ?? video.repoPath
    const enhancementResult = await runStage<VisualEnhancementResult | undefined>(
      Stage.VisualEnhancement,
      async () => {
        const result = await enhanceVideo(videoToEnhance, captionTranscript, video)
        if (!result) return undefined
        return result
      },
      stageResults,
    )
    if (enhancementResult) {
      enhancedVideoPath = enhancementResult.enhancedVideoPath
    }
  }

  // 4. Captions (fast, no AI needed) — generate from the right transcript
  let captions: string[] | undefined
  if (captionTranscript && !cfg.SKIP_CAPTIONS) {
    captions = await trackStage<string[]>(Stage.Captions, () => videoAsset.generateCaptionFiles(captionTranscript))
  }

  // 5. Caption Burn — use single-pass (silence removal + captions) when possible
  let captionedVideoPath: string | undefined
  if (captions && !cfg.SKIP_CAPTIONS) {
    const assFile = captions.find((p) => p.endsWith('.ass'))
    if (assFile && cleaningKeepSegments && !enhancedVideoPath) {
      // Single-pass: re-do cleaning + burn captions from ORIGINAL video in one encode
      // Skip single-pass when enhanced video exists (it already has cleaning baked in)
      const captionedOutput = join(video.videoDir, `${video.slug}-captioned.mp4`)
      captionedVideoPath = await trackStage<string>(
        Stage.CaptionBurn,
        () => videoAsset.singlePassEditAndBurnCaptions(video.repoPath, cleaningKeepSegments!, assFile, captionedOutput),
      )
    } else if (assFile) {
      // No cleaning — just burn captions into original video
      const videoToBurn = enhancedVideoPath ?? editedVideoPath ?? video.repoPath
      const captionedOutput = join(video.videoDir, `${video.slug}-captioned.mp4`)
      captionedVideoPath = await trackStage<string>(
        Stage.CaptionBurn,
        () => videoAsset.burnCaptionFiles(videoToBurn, assFile, captionedOutput),
      )
    }
  }

  // 6. Shorts — use adjusted transcript + cleaned video (clips cut from cleaned video)
  let shorts: ShortClip[] = []
  if (transcript && !cfg.SKIP_SHORTS) {
    const shortsTranscript = adjustedTranscript ?? transcript
    let clipDirection: string | undefined
    try {
      const clipDirPath = join(video.videoDir, 'clip-direction.md')
      if (await fileExists(clipDirPath)) {
        clipDirection = await readTextFile(clipDirPath)
      }
    } catch { /* clip direction is optional */ }

    // Read pre-detected webcam region from layout.json so shorts don't re-detect per clip
    let webcamRegion: VideoLayout['webcam'] | undefined
    try {
      const layoutPath = join(video.videoDir, 'layout.json')
      if (await fileExists(layoutPath)) {
        const layout = await readJsonFile<VideoLayout>(layoutPath)
        webcamRegion = layout.webcam
      }
    } catch { /* layout is optional — shorts will detect per clip if unavailable */ }

    const result = await trackStage<ShortClip[]>(Stage.Shorts, () => videoAsset.generateShortClips(shortsTranscript, getModelForAgent('ShortsAgent'), clipDirection, webcamRegion, editedVideoPath))
    if (result) shorts = result
  }

  // 7. Medium Clips — use enhanced video if available (carries overlay images), else cleaned video
  let mediumClips: MediumClip[] = []
  if (transcript && !cfg.SKIP_MEDIUM_CLIPS) {
    const mediumTranscript = adjustedTranscript ?? transcript
    const mediumVideoPath = enhancedVideoPath ?? editedVideoPath
    let mediumClipDirection: string | undefined
    try {
      const clipDirPath = join(video.videoDir, 'clip-direction.md')
      if (await fileExists(clipDirPath)) {
        mediumClipDirection = await readTextFile(clipDirPath)
      }
    } catch { /* clip direction is optional */ }
    const result = await trackStage<MediumClip[]>(Stage.MediumClips, () => videoAsset.generateMediumClipData(mediumTranscript, getModelForAgent('MediumVideoAgent'), mediumClipDirection, mediumVideoPath))
    if (result) mediumClips = result
  }

  // All downstream stages use the adjusted transcript (post-cleaning) when available
  const downstreamTranscript = adjustedTranscript ?? transcript

  // 8. Chapters — analyse transcript for topic boundaries
  let chapters: Chapter[] | undefined
  if (downstreamTranscript) {
    chapters = await trackStage<Chapter[]>(Stage.Chapters, () => videoAsset.generateChapterData(downstreamTranscript, getModelForAgent('ChapterAgent')))
  }

  // 9. Summary (after shorts, medium clips, and chapters so the README can reference them)
  let summary: VideoSummary | undefined
  if (downstreamTranscript) {
    summary = await trackStage<VideoSummary>(Stage.Summary, () => videoAsset.generateSummaryContent(downstreamTranscript, shorts, chapters, getModelForAgent('SummaryAgent')))
  }

  // 10. Social Media
  let socialPosts: SocialPost[] = []
  if (downstreamTranscript && summary && !cfg.SKIP_SOCIAL) {
    const result = await trackStage<SocialPost[]>(
      Stage.SocialMedia,
      () => videoAsset.generateSocialPostsData(downstreamTranscript, summary, join(video.videoDir, 'social-posts'), getModelForAgent('SocialMediaAgent')),
    )
    if (result) socialPosts = result
  }

  // 11. Short Posts — generate social posts per short clip
  if (downstreamTranscript && shorts.length > 0 && !cfg.SKIP_SOCIAL) {
    await trackStage<void>(
      Stage.ShortPosts,
      async () => {
        for (const short of shorts) {
          const posts = await videoAsset.generateShortPostsData(short, downstreamTranscript, getModelForAgent('ShortPostsAgent'))
          socialPosts.push(...posts)
        }
      },
    )
  }

  // 12. Medium Clip Posts — generate social posts per medium clip
  if (downstreamTranscript && mediumClips.length > 0 && !cfg.SKIP_SOCIAL) {
    await trackStage<void>(
      Stage.MediumClipPosts,
      async () => {
        for (const clip of mediumClips) {
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
          const posts = await videoAsset.generateShortPostsData(asShortClip, downstreamTranscript, getModelForAgent('MediumClipPostsAgent'))
          // Move posts to medium-clips/{slug}/posts/
          const clipsDir = join(dirname(video.repoPath), 'medium-clips')
          const postsDir = join(clipsDir, clip.slug, 'posts')
          await ensureDirectory(postsDir)
          for (const post of posts) {
            const destPath = join(postsDir, basename(post.outputPath))
            await copyFile(post.outputPath, destPath)
            await removeFile(post.outputPath)
            post.outputPath = destPath
          }
          socialPosts.push(...posts)
        }
      },
    )
  }

  // 13. Queue Build — populate publish-queue/ for review
  if (socialPosts.length > 0 && !cfg.SKIP_SOCIAL_PUBLISH) {
    await trackStage<QueueBuildResult>(
      Stage.QueueBuild,
      () => videoAsset.buildPublishQueueData(shorts, mediumClips, socialPosts, captionedVideoPath),
    )
  }

  // 14. Blog Post
  let blogPost: string | undefined
  if (downstreamTranscript && summary) {
    blogPost = await trackStage<string>(
      Stage.Blog,
      () => videoAsset.generateBlogPostContent(downstreamTranscript, summary, getModelForAgent('BlogAgent')),
    )
  }

  // 15. Git
  if (!cfg.SKIP_GIT) {
    await trackStage<void>(Stage.GitPush, () => videoAsset.commitAndPushChanges())
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
    captions,
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
