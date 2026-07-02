import { createFFmpeg } from './ffmpeg.js'
import { detectSilence, type SilenceRegion } from './silenceDetection.js'
import logger from '../../L1-infra/logger/configLogger.js'
import type { RecordingGlitch, RecordingGlitchManifest } from '../../L0-pure/types/index.js'

interface FreezeRegion {
  start: number
  end: number
  duration: number
}

export interface RecordingGlitchDetectionOptions {
  freezeMinDuration?: number
  freezeNoiseTolerance?: string
  audioMinDuration?: number
  audioNoiseThreshold?: string
  autoTrimMaxDuration?: number
  correlationGap?: number
}

const DEFAULT_OPTIONS: Required<RecordingGlitchDetectionOptions> = {
  freezeMinDuration: 0.08,
  freezeNoiseTolerance: '0.001',
  audioMinDuration: 0.08,
  audioNoiseThreshold: '-45dB',
  autoTrimMaxDuration: 0.5,
  correlationGap: 0.15,
}

async function detectFreezeFrames(
  videoPath: string,
  minDuration: number,
  noiseTolerance: string,
): Promise<FreezeRegion[]> {
  logger.info(`Detecting freeze frames in: ${videoPath} (min=${minDuration}s, noise=${noiseTolerance})`)

  return new Promise<FreezeRegion[]>((resolve, reject) => {
    const regions: FreezeRegion[] = []
    let pendingStart: number | null = null
    let stderr = ''

    createFFmpeg(videoPath)
      .videoFilters(`freezedetect=n=${noiseTolerance}:d=${minDuration}`)
      .format('null')
      .output('-')
      .on('stderr', (line: string) => {
        stderr += line + '\n'
      })
      .on('end', () => {
        for (const line of stderr.split('\n')) {
          const startMatch = line.match(/freeze_start:\s*([\d.]+)/)
          if (startMatch) {
            pendingStart = parseFloat(startMatch[1])
          }

          const endMatch = line.match(/freeze_end:\s*([\d.]+)\s*\|\s*freeze_duration:\s*([\d.]+)/)
          if (endMatch) {
            const end = parseFloat(endMatch[1])
            const duration = parseFloat(endMatch[2])
            const start = pendingStart ?? Math.max(0, end - duration)
            regions.push({ start, end, duration })
            pendingStart = null
          }
        }

        const validRegions = regions.filter(region => region.end > region.start)
        logger.info(`Detected ${validRegions.length} freeze-frame regions`)
        resolve(validRegions)
      })
      .on('error', (err) => {
        logger.error(`Freeze detection failed: ${err.message}`)
        reject(new Error(`Freeze detection failed: ${err.message}`))
      })
      .run()
  })
}

function overlapsWithGap(
  a: { start: number; end: number },
  b: { start: number; end: number },
  gap: number,
): boolean {
  return a.start <= b.end + gap && b.start <= a.end + gap
}

function sortByStart<T extends { start: number }>(regions: T[]): T[] {
  return [...regions].sort((a, b) => a.start - b.start)
}

export async function detectRecordingGlitches(
  videoPath: string,
  options: RecordingGlitchDetectionOptions = {},
): Promise<RecordingGlitchManifest> {
  const resolved = { ...DEFAULT_OPTIONS, ...options }
  const [freezeRegions, audioRegions] = await Promise.all([
    detectFreezeFrames(videoPath, resolved.freezeMinDuration, resolved.freezeNoiseTolerance),
    detectSilence(videoPath, resolved.audioMinDuration, resolved.audioNoiseThreshold),
  ])

  const glitches: RecordingGlitch[] = []
  const matchedAudio = new Set<number>()

  for (const freeze of freezeRegions) {
    const overlappingAudio = audioRegions
      .map((region, index) => ({ region, index }))
      .filter(({ region }) => overlapsWithGap(freeze, region, resolved.correlationGap))

    if (overlappingAudio.length > 0) {
      for (const { index } of overlappingAudio) matchedAudio.add(index)
      const mergedStart = Math.min(freeze.start, ...overlappingAudio.map(({ region }) => region.start))
      const mergedEnd = Math.max(freeze.end, ...overlappingAudio.map(({ region }) => region.end))
      const duration = mergedEnd - mergedStart

      glitches.push({
        type: 'freeze-with-audio-dropout',
        start: mergedStart,
        end: mergedEnd,
        duration,
        action: duration <= resolved.autoTrimMaxDuration ? 'auto-trim' : 'review',
        confidence: 'high',
        detectors: ['freezedetect', 'silencedetect'],
      })
      continue
    }

    glitches.push({
      type: 'freeze-frame',
      start: freeze.start,
      end: freeze.end,
      duration: freeze.duration,
      action: 'review',
      confidence: 'medium',
      detectors: ['freezedetect'],
    })
  }

  audioRegions.forEach((region: SilenceRegion, index: number) => {
    if (matchedAudio.has(index)) return
    glitches.push({
      type: 'audio-dropout',
      start: region.start,
      end: region.end,
      duration: region.duration,
      action: 'review',
      confidence: 'medium',
      detectors: ['silencedetect'],
    })
  })

  return {
    generatedAt: new Date().toISOString(),
    videoPath,
    thresholds: {
      freezeMinDuration: resolved.freezeMinDuration,
      audioMinDuration: resolved.audioMinDuration,
      audioNoiseThreshold: resolved.audioNoiseThreshold,
      autoTrimMaxDuration: resolved.autoTrimMaxDuration,
    },
    glitches: sortByStart(glitches),
  }
}
