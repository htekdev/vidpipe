import path from 'path'
import fsp from 'fs/promises'
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
  const captionsDir = path.join(config.OUTPUT_DIR, video.slug, 'captions')
  await fsp.mkdir(captionsDir, { recursive: true })

  const srtPath = path.join(captionsDir, 'captions.srt')
  const vttPath = path.join(captionsDir, 'captions.vtt')
  const assPath = path.join(captionsDir, 'captions.ass')

  const srt = generateSRT(transcript)
  const vtt = generateVTT(transcript)
  const ass = generateStyledASS(transcript)

  await Promise.all([
    fsp.writeFile(srtPath, srt, 'utf-8'),
    fsp.writeFile(vttPath, vtt, 'utf-8'),
    fsp.writeFile(assPath, ass, 'utf-8'),
  ])

  const paths = [srtPath, vttPath, assPath]
  logger.info(`Captions saved: ${paths.join(', ')}`)
  return paths
}
