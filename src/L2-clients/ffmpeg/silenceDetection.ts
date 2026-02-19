import { createFFmpeg } from './ffmpeg.js'
import logger from '../../L1-infra/logger/configLogger'

export interface SilenceRegion {
  start: number   // seconds
  end: number     // seconds
  duration: number // seconds
}

/**
 * Use FFmpeg silencedetect filter to find silence regions in an audio/video file.
 */
export async function detectSilence(
  audioPath: string,
  minDuration: number = 1.0,
  noiseThreshold: string = '-30dB',
): Promise<SilenceRegion[]> {
  logger.info(`Detecting silence in: ${audioPath} (min=${minDuration}s, threshold=${noiseThreshold})`)

  return new Promise<SilenceRegion[]>((resolve, reject) => {
    const regions: SilenceRegion[] = []
    let stderr = ''

    createFFmpeg(audioPath)
      .audioFilters(`silencedetect=noise=${noiseThreshold}:d=${minDuration}`)
      .format('null')
      .output('-')
      .on('stderr', (line: string) => {
        stderr += line + '\n'
      })
      .on('end', () => {
        let pendingStart: number | null = null

        for (const line of stderr.split('\n')) {
          const startMatch = line.match(/silence_start:\s*([\d.]+)/)
          if (startMatch) {
            pendingStart = parseFloat(startMatch[1])
          }

          const endMatch = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/)
          if (endMatch) {
            const end = parseFloat(endMatch[1])
            const duration = parseFloat(endMatch[2])
            // When silence starts at t=0, FFmpeg emits silence_end before any silence_start
            const start = pendingStart ?? Math.max(0, end - duration)

            regions.push({ start, end, duration })
            pendingStart = null
          }
        }

        const badRegions = regions.filter(r => r.end <= r.start)
        if (badRegions.length > 0) {
          logger.warn(`[SilenceDetect] Found ${badRegions.length} invalid regions (end <= start) — filtering out`)
        }
        const validRegions = regions.filter(r => r.end > r.start)

        if (validRegions.length > 0) {
          logger.info(`Sample silence regions: ${validRegions.slice(0, 3).map(r => `${r.start.toFixed(1)}s-${r.end.toFixed(1)}s (${r.duration.toFixed(2)}s)`).join(', ')}`)
        }
        logger.info(`Detected ${validRegions.length} silence regions`)
        resolve(validRegions)
      })
      .on('error', (err) => {
        logger.error(`Silence detection failed: ${err.message}`)
        reject(new Error(`Silence detection failed: ${err.message}`))
      })
      .run()
  })
}
