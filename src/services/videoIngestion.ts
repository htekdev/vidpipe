import { join, basename, extname } from '../core/paths.js'
import { fileExistsSync, ensureDirectory, copyFile, getFileStats, listDirectory, removeDirectory, removeFile, openReadStream, openWriteStream } from '../core/fileSystem.js'
import { slugify } from '../core/text.js'
import { ffprobe } from '../core/ffmpeg.js'
import { VideoFile } from '../types'
import { getConfig } from '../config/environment'
import logger from '../config/logger'

async function getVideoMetadata(filePath: string): Promise<{ duration: number }> {
  const metadata = await ffprobe(filePath)
  return { duration: metadata.format.duration ?? 0 }
}

export async function ingestVideo(sourcePath: string): Promise<VideoFile> {
  const config = getConfig()
  const baseName = basename(sourcePath, extname(sourcePath))
  const slug = slugify(baseName, { lower: true })

  const recordingsDir = join(config.OUTPUT_DIR, slug)
  const thumbnailsDir = join(recordingsDir, 'thumbnails')
  const shortsDir = join(recordingsDir, 'shorts')
  const socialPostsDir = join(recordingsDir, 'social-posts')

  logger.info(`Ingesting video: ${sourcePath} → ${slug}`)

  // Clean stale artifacts if output folder already exists
  if (fileExistsSync(recordingsDir)) {
    logger.warn(`Output folder already exists, cleaning previous artifacts: ${recordingsDir}`)

    const subDirs = ['thumbnails', 'shorts', 'social-posts', 'chapters', 'medium-clips', 'captions']
    for (const sub of subDirs) {
      await removeDirectory(join(recordingsDir, sub), { recursive: true, force: true })
    }

    const stalePatterns = [
      'transcript.json', 'transcript-edited.json',
      'captions.srt', 'captions.vtt', 'captions.ass',
      'summary.md', 'blog-post.md', 'README.md',
    ]
    for (const pattern of stalePatterns) {
      await removeFile(join(recordingsDir, pattern))
    }

    const files = await listDirectory(recordingsDir)
    for (const file of files) {
      if (file.endsWith('-edited.mp4') || file.endsWith('-captioned.mp4')) {
        await removeFile(join(recordingsDir, file))
      }
    }
  }

  await ensureDirectory(recordingsDir)
  await ensureDirectory(thumbnailsDir)
  await ensureDirectory(shortsDir)
  await ensureDirectory(socialPostsDir)

  const destFilename = `${slug}.mp4`
  const destPath = join(recordingsDir, destFilename)

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

  let duration = 0
  try {
    const meta = await getVideoMetadata(destPath)
    duration = meta.duration
  } catch (err) {
    logger.warn(`ffprobe failed, continuing without duration metadata: ${err instanceof Error ? err.message : String(err)}`)
  }
  const stats = await getFileStats(destPath)

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
