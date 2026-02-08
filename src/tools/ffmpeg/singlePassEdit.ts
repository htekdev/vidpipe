import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import logger from '../../config/logger'
import { getFFmpegPath } from '../../config/ffmpegResolver.js'

const ffmpegPath = getFFmpegPath()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FONTS_DIR = path.resolve(__dirname, '..', '..', '..', 'assets', 'fonts')

export interface KeepSegment {
  start: number
  end: number
}

/**
 * Build FFmpeg filter_complex string for silence removal.
 * Pure function — no I/O, easy to test.
 */
export function buildFilterComplex(
  keepSegments: KeepSegment[],
  options?: { assFilename?: string; fontsdir?: string },
): string {
  if (keepSegments.length === 0) {
    throw new Error('keepSegments must not be empty')
  }

  const filterParts: string[] = []
  const concatInputs: string[] = []
  const hasCaptions = options?.assFilename

  for (let i = 0; i < keepSegments.length; i++) {
    const seg = keepSegments[i]
    filterParts.push(
      `[0:v]trim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`,
    )
    filterParts.push(
      `[0:a]atrim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`,
    )
    concatInputs.push(`[v${i}][a${i}]`)
  }

  const concatOutV = hasCaptions ? '[cv]' : '[outv]'
  const concatOutA = hasCaptions ? '[ca]' : '[outa]'

  filterParts.push(
    `${concatInputs.join('')}concat=n=${keepSegments.length}:v=1:a=1${concatOutV}${concatOutA}`,
  )

  if (hasCaptions) {
    const fontsdir = options?.fontsdir ?? '.'
    filterParts.push(`[cv]ass=${options!.assFilename}:fontsdir=${fontsdir}[outv]`)
  }

  return filterParts.join(';\n')
}

/**
 * Single-pass silence removal using FFmpeg filter_complex.
 * Uses trim+setpts+concat for frame-accurate cuts instead of -c copy which
 * snaps to keyframes and causes cumulative timestamp drift.
 */
export async function singlePassEdit(
  inputPath: string,
  keepSegments: KeepSegment[],
  outputPath: string,
): Promise<string> {
  const filterComplex = buildFilterComplex(keepSegments)

  const args = [
    '-y',
    '-i', inputPath,
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-map', '[outa]',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-threads', '4',
    '-c:a', 'aac',
    '-b:a', '128k',
    outputPath,
  ]

  logger.info(`[SinglePassEdit] Editing ${keepSegments.length} segments → ${outputPath}`)

  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 50 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        logger.error(`[SinglePassEdit] FFmpeg failed: ${stderr}`)
        reject(new Error(`Single-pass edit failed: ${error.message}`))
        return
      }
      logger.info(`[SinglePassEdit] Complete: ${outputPath}`)
      resolve(outputPath)
    })
  })
}

/**
 * Single-pass silence removal + caption burning using FFmpeg filter_complex.
 * Uses trim+setpts+concat for frame-accurate cuts, then chains ass filter for captions.
 * One re-encode, perfect timestamp alignment.
 */
export async function singlePassEditAndCaption(
  inputPath: string,
  keepSegments: KeepSegment[],
  assPath: string,
  outputPath: string,
): Promise<string> {
  // Copy ASS + bundled fonts to temp dir to avoid Windows drive colon issue
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'caption-'))
  const tempAss = path.join(tempDir, 'captions.ass')
  await fs.copyFile(assPath, tempAss)

  const fontFiles = await fs.readdir(FONTS_DIR)
  for (const f of fontFiles) {
    if (f.endsWith('.ttf') || f.endsWith('.otf')) {
      await fs.copyFile(path.join(FONTS_DIR, f), path.join(tempDir, f))
    }
  }

  const filterComplex = buildFilterComplex(keepSegments, {
    assFilename: 'captions.ass',
    fontsdir: '.',
  })

  const args = [
    '-y',
    '-i', inputPath,
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-map', '[ca]',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-threads', '4',
    '-c:a', 'aac',
    '-b:a', '128k',
    outputPath,
  ]

  logger.info(`[SinglePassEdit] Processing ${keepSegments.length} segments with captions → ${outputPath}`)

  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { cwd: tempDir, maxBuffer: 50 * 1024 * 1024 }, async (error, _stdout, stderr) => {
      // Cleanup temp
      const files = await fs.readdir(tempDir).catch(() => [] as string[])
      for (const f of files) {
        await fs.unlink(path.join(tempDir, f)).catch(() => {})
      }
      await fs.rmdir(tempDir).catch(() => {})

      if (error) {
        logger.error(`[SinglePassEdit] FFmpeg failed: ${stderr}`)
        reject(new Error(`Single-pass edit failed: ${error.message}`))
        return
      }
      logger.info(`[SinglePassEdit] Complete: ${outputPath}`)
      resolve(outputPath)
    })
  })
}
