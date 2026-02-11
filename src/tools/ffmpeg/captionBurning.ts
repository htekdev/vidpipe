import { execFileRaw } from '../../core/process.js'
import { ensureDirectory, copyFile, listDirectory, removeFile, removeDirectory, makeTempDir, renameFile } from '../../core/fileSystem.js'
import { dirname, join, fontsDir } from '../../core/paths.js'
import { getFFmpegPath } from '../../core/ffmpeg.js'
import logger from '../../config/logger'

const ffmpegPath = getFFmpegPath()
const FONTS_DIR = fontsDir()

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
  const outputDir = dirname(outputPath)
  await ensureDirectory(outputDir)

  logger.info(`Burning captions into video → ${outputPath}`)

  // Create a dedicated temp dir so we can use colon-free relative paths
  const workDir = await makeTempDir('caption-')
  const tempAss = join(workDir, 'captions.ass')
  const tempOutput = join(workDir, 'output.mp4')

  await copyFile(assPath, tempAss)

  // Copy bundled fonts so libass can find them via fontsdir=.
  let fontFiles: string[]
  try {
    fontFiles = await listDirectory(FONTS_DIR)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw new Error(`Fonts directory not found at ${FONTS_DIR}. Ensure assets/fonts/ exists in the project root.`)
    }
    throw err
  }
  for (const f of fontFiles) {
    if (f.endsWith('.ttf') || f.endsWith('.otf')) {
      await copyFile(join(FONTS_DIR, f), join(workDir, f))
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
    execFileRaw(ffmpegPath, args, { cwd: workDir, maxBuffer: 10 * 1024 * 1024 }, async (error, _stdout, stderr) => {
      const cleanup = async () => {
        const files = await listDirectory(workDir).catch(() => [] as string[])
        for (const f of files) {
          await removeFile(join(workDir, f)).catch(() => {})
        }
        await removeDirectory(workDir).catch(() => {})
      }

      if (error) {
        await cleanup()
        logger.error(`Caption burning failed: ${stderr || error.message}`)
        reject(new Error(`Caption burning failed: ${stderr || error.message}`))
        return
      }

      try {
        await renameFile(tempOutput, outputPath)
      } catch {
        await copyFile(tempOutput, outputPath)
      }
      await cleanup()
      logger.info(`Captions burned: ${outputPath}`)
      resolve(outputPath)
    })
  })
}
