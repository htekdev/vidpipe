import { execFile } from 'child_process'
import { promises as fs, existsSync } from 'fs'
import pathMod from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import logger from '../../config/logger'
import { getFFmpegPath } from '../../config/ffmpegResolver.js'

const ffmpegPath = getFFmpegPath()
const __dirname = pathMod.dirname(fileURLToPath(import.meta.url))

// In tsup bundle: __dirname = dist/tools/ffmpeg/, fonts copied to dist/fonts/
// In dev (tsx): __dirname = src/tools/ffmpeg/, fonts at ../../../assets/fonts/
const bundledFontsDir = pathMod.resolve(__dirname, '..', '..', 'fonts')
const FONTS_DIR = existsSync(bundledFontsDir)
  ? bundledFontsDir
  : pathMod.resolve(__dirname, '..', '..', '..', 'assets', 'fonts')

/**
 * Burn ASS subtitles into video (hard-coded subtitles).
 * Uses direct execFile instead of fluent-ffmpeg to avoid Windows path escaping issues.
 * Copies the ASS file to a temp dir and uses a relative path to dodge the Windows
 * drive-letter colon being parsed as an FFmpeg filter option separator.
 */
export async function burnCaptions(
  videoPath: string,
  assPath: string,
  outputPath: string,
): Promise<string> {
  const outputDir = pathMod.dirname(outputPath)
  await fs.mkdir(outputDir, { recursive: true })

  logger.info(`Burning captions into video → ${outputPath}`)

  // Create a dedicated temp dir so we can use colon-free relative paths
  const workDir = await fs.mkdtemp(pathMod.join(os.tmpdir(), 'caption-'))
  const tempAss = pathMod.join(workDir, 'captions.ass')
  const tempOutput = pathMod.join(workDir, 'output.mp4')

  await fs.copyFile(assPath, tempAss)

  // Copy bundled fonts so libass can find them via fontsdir=.
  let fontFiles: string[]
  try {
    fontFiles = await fs.readdir(FONTS_DIR)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw new Error(`Fonts directory not found at ${FONTS_DIR}. Ensure assets/fonts/ exists in the project root.`)
    }
    throw err
  }
  for (const f of fontFiles) {
    if (f.endsWith('.ttf') || f.endsWith('.otf')) {
      await fs.copyFile(pathMod.join(FONTS_DIR, f), pathMod.join(workDir, f))
    }
  }

  // Use just the filename — no drive letter, no colons
  const args = [
    '-y',
    '-i', videoPath,
    '-vf', 'ass=captions.ass:fontsdir=.',
    '-c:a', 'copy',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-threads', '4',
    tempOutput,
  ]

  return new Promise<string>((resolve, reject) => {
    execFile(ffmpegPath, args, { cwd: workDir, maxBuffer: 10 * 1024 * 1024 }, async (error, _stdout, stderr) => {
      const cleanup = async () => {
        const files = await fs.readdir(workDir).catch(() => [] as string[])
        for (const f of files) {
          await fs.unlink(pathMod.join(workDir, f)).catch(() => {})
        }
        await fs.rmdir(workDir).catch(() => {})
      }

      if (error) {
        await cleanup()
        logger.error(`Caption burning failed: ${stderr || error.message}`)
        reject(new Error(`Caption burning failed: ${stderr || error.message}`))
        return
      }

      try {
        await fs.rename(tempOutput, outputPath)
      } catch {
        await fs.copyFile(tempOutput, outputPath)
      }
      await cleanup()
      logger.info(`Captions burned: ${outputPath}`)
      resolve(outputPath)
    })
  })
}
