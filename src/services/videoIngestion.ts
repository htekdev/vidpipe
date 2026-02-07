import path from 'path'
import fs from 'fs'
import fsp from 'fs/promises'
import slugify from 'slugify'
import ffmpeg from 'fluent-ffmpeg'
import { VideoFile } from '../types'
import { getConfig } from '../config/environment'
import logger from '../config/logger'

const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg'
const ffprobeBin = process.env.FFPROBE_PATH || 'ffprobe'
ffmpeg.setFfmpegPath(ffmpegBin)
ffmpeg.setFfprobePath(ffprobeBin)

function getVideoMetadata(filePath: string): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        return reject(err)
      }
      resolve({ duration: metadata.format.duration ?? 0 })
    })
  })
}

export async function ingestVideo(sourcePath: string): Promise<VideoFile> {
  const config = getConfig()
  const baseName = path.basename(sourcePath, path.extname(sourcePath))
  const slug = slugify(baseName, { lower: true })

  const recordingsDir = path.join(config.OUTPUT_DIR, slug)
  const thumbnailsDir = path.join(recordingsDir, 'thumbnails')
  const shortsDir = path.join(recordingsDir, 'shorts')
  const socialPostsDir = path.join(recordingsDir, 'social-posts')

  logger.info(`Ingesting video: ${sourcePath} → ${slug}`)

  // Clean stale artifacts if output folder already exists
  if (fs.existsSync(recordingsDir)) {
    logger.warn(`Output folder already exists, cleaning previous artifacts: ${recordingsDir}`)

    const subDirs = ['thumbnails', 'shorts', 'social-posts', 'chapters', 'mediums']
    for (const sub of subDirs) {
      await fsp.rm(path.join(recordingsDir, sub), { recursive: true, force: true })
    }

    const stalePatterns = [
      'transcript.json', 'transcript-edited.json',
      'captions.srt', 'captions.vtt', 'captions.ass',
      'summary.md', 'blog-post.md', 'README.md',
    ]
    for (const pattern of stalePatterns) {
      await fsp.rm(path.join(recordingsDir, pattern), { force: true })
    }

    const files = await fsp.readdir(recordingsDir)
    for (const file of files) {
      if (file.endsWith('-edited.mp4') || file.endsWith('-captioned.mp4')) {
        await fsp.rm(path.join(recordingsDir, file), { force: true })
      }
    }
  }

  await fsp.mkdir(recordingsDir, { recursive: true })
  await fsp.mkdir(thumbnailsDir, { recursive: true })
  await fsp.mkdir(shortsDir, { recursive: true })
  await fsp.mkdir(socialPostsDir, { recursive: true })

  const destFilename = `${slug}.mp4`
  const destPath = path.join(recordingsDir, destFilename)

  let needsCopy = true
  try {
    const destStats = await fsp.stat(destPath)
    const srcStats = await fsp.stat(sourcePath)
    if (destStats.size === srcStats.size) {
      logger.info(`Video already copied (same size), skipping copy`)
      needsCopy = false
    }
  } catch {
    // Dest doesn't exist, need to copy
  }

  if (needsCopy) {
    await new Promise<void>((resolve, reject) => {
      const readStream = fs.createReadStream(sourcePath)
      const writeStream = fs.createWriteStream(destPath)
      readStream.on('error', reject)
      writeStream.on('error', reject)
      writeStream.on('finish', resolve)
      readStream.pipe(writeStream)
    })
    logger.info(`Copied video to ${destPath}`)
  }

  let duration = 0
  try {
    const meta = await getVideoMetadata(destPath)
    duration = meta.duration
  } catch (err) {
    logger.warn(`ffprobe failed, continuing without duration metadata: ${err instanceof Error ? err.message : String(err)}`)
  }
  const stats = await fsp.stat(destPath)

  logger.info(`Video metadata: duration=${duration}s, size=${stats.size} bytes`)

  return {
    originalPath: sourcePath,
    repoPath: destPath,
    videoDir: recordingsDir,
    slug,
    filename: destFilename,
    duration,
    size: stats.size,
    createdAt: new Date(),
  }
}
