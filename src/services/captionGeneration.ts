import { join } from '../core/paths.js'
import { writeTextFile, ensureDirectory } from '../core/fileSystem.js'
import { VideoFile, Transcript } from '../types'
import { generateSRT, generateVTT, generateStyledASS } from '../tools/captions/captionGenerator'
import { getConfig } from '../config/environment'
import logger from '../config/logger'

/**
 * Generate SRT, VTT, and ASS caption files for a video and save them to disk.
 * Returns the list of written file paths.
 */
export async function generateCaptions(
  video: VideoFile,
  transcript: Transcript,
): Promise<string[]> {
  const config = getConfig()
  const captionsDir = join(config.OUTPUT_DIR, video.slug, 'captions')
  await ensureDirectory(captionsDir)

  const srtPath = join(captionsDir, 'captions.srt')
  const vttPath = join(captionsDir, 'captions.vtt')
  const assPath = join(captionsDir, 'captions.ass')

  const srt = generateSRT(transcript)
  const vtt = generateVTT(transcript)
  const ass = generateStyledASS(transcript)

  await Promise.all([
    writeTextFile(srtPath, srt),
    writeTextFile(vttPath, vtt),
    writeTextFile(assPath, ass),
  ])

  const paths = [srtPath, vttPath, assPath]
  logger.info(`Captions saved: ${paths.join(', ')}`)
  return paths
}
