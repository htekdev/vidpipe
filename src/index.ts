import { Command } from 'commander'
import { initConfig, validateRequiredKeys, getConfig } from './config/environment'
import type { CLIOptions } from './config/environment'
import { FileWatcher } from './services/fileWatcher'
import { processVideoSafe } from './pipeline'
import logger, { setVerbose } from './config/logger'
import path from 'path'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8'))

const BANNER = `
╔══════════════════════════════════════╗
║   VidPipe  v${pkg.version.padEnd(24)}║
╚══════════════════════════════════════╝
`

const program = new Command()

program
  .name('vidpipe')
  .description('AI-powered video content pipeline: transcribe, summarize, generate shorts, captions, and social posts')
  .version(pkg.version, '-V, --version')
  .argument('[video-path]', 'Path to a video file to process (implies --once)')
  .option('--watch-dir <path>', 'Folder to watch for new recordings (default: env WATCH_FOLDER)')
  .option('--output-dir <path>', 'Output directory for processed videos (default: ./recordings)')
  .option('--openai-key <key>', 'OpenAI API key (default: env OPENAI_API_KEY)')
  .option('--exa-key <key>', 'Exa AI API key for web search (default: env EXA_API_KEY)')
  .option('--once', 'Process a single video and exit (no watching)')
  .option('--brand <path>', 'Path to brand.json config (default: ./brand.json)')
  .option('--no-git', 'Skip git commit/push stage')
  .option('--no-silence-removal', 'Skip silence removal stage')
  .option('--no-shorts', 'Skip shorts generation')
  .option('--no-medium-clips', 'Skip medium clip generation')
  .option('--no-social', 'Skip social media post generation')
  .option('--no-captions', 'Skip caption generation/burning')
  .option('-v, --verbose', 'Verbose logging')

program.parse()

const opts = program.opts()
const videoArg = program.args[0]
const onceMode: boolean = opts.once || !!videoArg

const cliOptions: CLIOptions = {
  watchDir: opts.watchDir,
  outputDir: opts.outputDir,
  openaiKey: opts.openaiKey,
  exaKey: opts.exaKey,
  brand: opts.brand,
  verbose: opts.verbose,
  git: opts.git,
  silenceRemoval: opts.silenceRemoval,
  shorts: opts.shorts,
  mediumClips: opts.mediumClips,
  social: opts.social,
  captions: opts.captions,
}

const queue: string[] = []
let processing = false
let shutdownRequested = false
let watcher: FileWatcher | null = null

async function processQueue(): Promise<void> {
  if (processing || queue.length === 0) return
  processing = true

  try {
    while (queue.length > 0) {
      const videoPath = queue.shift()!
      logger.info(`Processing video: ${videoPath}`)
      await processVideoSafe(videoPath)

      if (onceMode) {
        logger.info('--once flag set, exiting after first video.')
        await shutdown()
        return
      }

      if (shutdownRequested) break
    }
  } finally {
    processing = false
  }
}

function enqueue(videoPath: string): void {
  queue.push(videoPath)
  logger.info(`Queued video: ${videoPath} (queue length: ${queue.length})`)
  processQueue().catch(err => logger.error('Queue processing error:', err))
}

async function shutdown(): Promise<void> {
  if (shutdownRequested) return
  shutdownRequested = true
  logger.info('Shutting down...')

  if (watcher) {
    watcher.stop()
  }

  while (processing) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  logger.info('Goodbye.')
  process.exit(0)
}

async function main(): Promise<void> {
  logger.info(BANNER)

  initConfig(cliOptions)
  if (opts.verbose) setVerbose()
  validateRequiredKeys()

  const config = getConfig()

  logger.info(`Watch folder: ${config.WATCH_FOLDER}`)
  logger.info(`Output dir:   ${config.OUTPUT_DIR}`)

  // Direct file mode: process a specific video and exit
  if (videoArg) {
    const resolvedPath = path.resolve(videoArg)
    logger.info(`Processing single video: ${resolvedPath}`)
    await processVideoSafe(resolvedPath)
    logger.info('Done.')
    process.exit(0)
  }

  // Watch mode
  watcher = new FileWatcher()
  watcher.on('new-video', (filePath: string) => {
    enqueue(filePath)
  })
  watcher.start()

  if (onceMode) {
    logger.info('Running in --once mode. Will exit after processing the next video.')
  } else {
    logger.info('Watching for new videos. Press Ctrl+C to stop.')
  }
}

process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())

main().catch((err) => {
  logger.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
