import path from 'path'
import { promises as fs } from 'fs'
import logger from './config/logger'
import { getConfig } from './config/environment'
import { ingestVideo } from './services/videoIngestion'
import { transcribeVideo } from './services/transcription'
import { generateCaptions } from './services/captionGeneration'
import { generateSummary } from './agents/SummaryAgent'
import { generateShorts } from './agents/ShortsAgent'
import { generateMediumClips } from './agents/MediumVideoAgent'
import { generateSocialPosts, generateShortPosts } from './agents/SocialMediaAgent'
import { generateBlogPost } from './agents/BlogAgent'
import { generateChapters } from './agents/ChapterAgent'
import { commitAndPush } from './services/gitOperations'
import { removeDeadSilence } from './agents/SilenceRemovalAgent'
import { burnCaptions } from './tools/ffmpeg/captionBurning'
import { singlePassEditAndCaption } from './tools/ffmpeg/singlePassEdit'
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
  SilenceRemovalResult,
  Chapter,
} from './types'
import { PipelineStage as Stage } from './types'

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

export async function processVideo(videoPath: string): Promise<PipelineResult> {
  const pipelineStart = Date.now()
  const stageResults: StageResult[] = []
  const cfg = getConfig()

  logger.info(`Pipeline starting for: ${videoPath}`)

  // 1. Ingestion — required for all subsequent stages
  const video = await runStage<VideoFile>(Stage.Ingestion, () => ingestVideo(videoPath), stageResults)
  if (!video) {
    const totalDuration = Date.now() - pipelineStart
    logger.error('Ingestion failed — cannot proceed without video metadata')
    return { video: { originalPath: videoPath, repoPath: '', videoDir: '', slug: '', filename: '', duration: 0, size: 0, createdAt: new Date() }, transcript: undefined, editedVideoPath: undefined, captions: undefined, captionedVideoPath: undefined, summary: undefined, shorts: [], mediumClips: [], socialPosts: [], blogPost: undefined, stageResults, totalDuration }
  }

  // 2. Transcription
  let transcript: Transcript | undefined
  transcript = await runStage<Transcript>(Stage.Transcription, () => transcribeVideo(video), stageResults)

  // 3. Silence Removal (context-aware)
  let editedVideoPath: string | undefined
  let adjustedTranscript: Transcript | undefined
  let silenceRemovals: { start: number; end: number }[] = []
  let silenceKeepSegments: { start: number; end: number }[] | undefined

  if (transcript && !cfg.SKIP_SILENCE_REMOVAL) {
    const result = await runStage<SilenceRemovalResult>(Stage.SilenceRemoval, () => removeDeadSilence(video, transcript!), stageResults)
    if (result && result.wasEdited) {
      editedVideoPath = result.editedPath
      silenceRemovals = result.removals
      silenceKeepSegments = result.keepSegments
      adjustedTranscript = adjustTranscript(transcript, silenceRemovals)

      // Validate: check that adjusted transcript duration is close to edited video duration
      const totalRemoved = silenceRemovals.reduce((sum, r) => sum + (r.end - r.start), 0)
      const expectedDuration = transcript.duration - totalRemoved
      const adjustedDuration = adjustedTranscript.duration
      const drift = Math.abs(expectedDuration - adjustedDuration)
      logger.info(`[Pipeline] Silence removal: original=${transcript.duration.toFixed(1)}s, removed=${totalRemoved.toFixed(1)}s, expected=${expectedDuration.toFixed(1)}s, adjusted=${adjustedDuration.toFixed(1)}s, drift=${drift.toFixed(1)}s`)

      await fs.writeFile(
        path.join(video.videoDir, 'transcript-edited.json'),
        JSON.stringify(adjustedTranscript, null, 2),
      )
    }
  }

  // Use adjusted transcript for captions (if silence was removed), original otherwise
  const captionTranscript = adjustedTranscript ?? transcript

  // 4. Captions (fast, no AI needed) — generate from the right transcript
  let captions: string[] | undefined
  if (captionTranscript && !cfg.SKIP_CAPTIONS) {
    captions = await runStage<string[]>(Stage.Captions, () => generateCaptions(video, captionTranscript), stageResults)
  }

  // 5. Caption Burn — use single-pass (silence removal + captions) when possible
  let captionedVideoPath: string | undefined
  if (captions && !cfg.SKIP_CAPTIONS) {
    const assFile = captions.find((p) => p.endsWith('.ass'))
    if (assFile && silenceKeepSegments) {
      // Single-pass: re-do silence removal + burn captions from ORIGINAL video in one encode
      // This guarantees frame-accurate cuts with perfectly aligned captions
      const captionedOutput = path.join(video.videoDir, `${video.slug}-captioned.mp4`)
      captionedVideoPath = await runStage<string>(
        Stage.CaptionBurn,
        () => singlePassEditAndCaption(video.repoPath, silenceKeepSegments!, assFile, captionedOutput),
        stageResults,
      )
    } else if (assFile) {
      // No silence removal — just burn captions into original video
      const videoToBurn = editedVideoPath ?? video.repoPath
      const captionedOutput = path.join(video.videoDir, `${video.slug}-captioned.mp4`)
      captionedVideoPath = await runStage<string>(
        Stage.CaptionBurn,
        () => burnCaptions(videoToBurn, assFile, captionedOutput),
        stageResults,
      )
    }
  }

  // 6. Shorts — use ORIGINAL transcript (shorts reference original video timestamps)
  let shorts: ShortClip[] = []
  if (transcript && !cfg.SKIP_SHORTS) {
    const result = await runStage<ShortClip[]>(Stage.Shorts, () => generateShorts(video, transcript), stageResults)
    if (result) shorts = result
  }

  // 7. Medium Clips — use ORIGINAL transcript (medium clips reference original video timestamps)
  let mediumClips: MediumClip[] = []
  if (transcript && !cfg.SKIP_MEDIUM_CLIPS) {
    const result = await runStage<MediumClip[]>(Stage.MediumClips, () => generateMediumClips(video, transcript), stageResults)
    if (result) mediumClips = result
  }

  // 8. Chapters — analyse transcript for topic boundaries
  let chapters: Chapter[] | undefined
  if (transcript) {
    chapters = await runStage<Chapter[]>(Stage.Chapters, () => generateChapters(video, transcript), stageResults)
  }

  // 9. Summary (after shorts, medium clips, and chapters so the README can reference them)
  let summary: VideoSummary | undefined
  if (transcript) {
    summary = await runStage<VideoSummary>(Stage.Summary, () => generateSummary(video, transcript, shorts, chapters), stageResults)
  }

  // 10. Social Media
  let socialPosts: SocialPost[] = []
  if (transcript && summary && !cfg.SKIP_SOCIAL) {
    const result = await runStage<SocialPost[]>(
      Stage.SocialMedia,
      () => generateSocialPosts(video, transcript, summary, path.join(video.videoDir, 'social-posts')),
      stageResults,
    )
    if (result) socialPosts = result
  }

  // 11. Short Posts — generate social posts per short clip
  if (transcript && shorts.length > 0 && !cfg.SKIP_SOCIAL) {
    await runStage<void>(
      Stage.ShortPosts,
      async () => {
        for (const short of shorts) {
          const posts = await generateShortPosts(video, short, transcript)
          socialPosts.push(...posts)
        }
      },
      stageResults,
    )
  }

  // 12. Medium Clip Posts — generate social posts per medium clip
  if (transcript && mediumClips.length > 0 && !cfg.SKIP_SOCIAL) {
    await runStage<void>(
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
          const posts = await generateShortPosts(video, asShortClip, transcript)
          // Move posts to medium-clips/{slug}/posts/
          const clipsDir = path.join(path.dirname(video.repoPath), 'medium-clips')
          const postsDir = path.join(clipsDir, clip.slug, 'posts')
          await fs.mkdir(postsDir, { recursive: true })
          for (const post of posts) {
            const destPath = path.join(postsDir, path.basename(post.outputPath))
            await fs.copyFile(post.outputPath, destPath)
            await fs.unlink(post.outputPath).catch(() => {})
            post.outputPath = destPath
          }
          socialPosts.push(...posts)
        }
      },
      stageResults,
    )
  }

  // 13. Blog Post
  let blogPost: string | undefined
  if (transcript && summary) {
    blogPost = await runStage<string>(
      Stage.Blog,
      () => generateBlogPost(video, transcript, summary),
      stageResults,
    )
  }

  // 14. Git
  if (!cfg.SKIP_GIT) {
    await runStage<void>(Stage.GitPush, () => commitAndPush(video.slug), stageResults)
  }

  const totalDuration = Date.now() - pipelineStart
  logger.info(`Pipeline completed in ${totalDuration}ms`)

  return {
    video,
    transcript,
    editedVideoPath,
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
}

export async function processVideoSafe(videoPath: string): Promise<PipelineResult | null> {
  try {
    return await processVideo(videoPath)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(`Pipeline failed with uncaught error: ${message}`)
    return null
  }
}
