import { Command } from 'commander'
import { initConfig, validateRequiredKeys, getConfig } from './config/environment'
import type { CLIOptions } from './config/environment'
import { FileWatcher } from './services/fileWatcher'
import { processVideoSafe } from './pipeline'
import logger, { setVerbose } from './config/logger'
import { runDoctor } from './commands/doctor'
import { runInit } from './commands/init'
import { runSchedule } from './commands/schedule'
import { startReviewServer } from './review/server'
import open from 'open'
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

// --- Subcommands ---

program
  .command('init')
  .description('Interactive setup wizard — configure API keys, providers, and social publishing')
  .action(async () => {
    await runInit()
    process.exit(0)
  })

program
  .command('review')
  .description('Open the social media post review app in your browser')
  .option('--port <number>', 'Server port (default: 3847)', '3847')
  .action(async (opts) => {
    initConfig()
    const { port, close } = await startReviewServer({ port: parseInt(opts.port) })
    await open(`http://localhost:${port}`)
    console.log(`\nReview app running at http://localhost:${port}`)
    console.log('Press Ctrl+C to stop.\n')

    const shutdown = async () => {
      console.log('\nShutting down...')
      // Restore terminal to normal mode on Windows
      if (process.platform === 'win32' && process.stdin.setRawMode) {
        process.stdin.setRawMode(false)
      }
      await close()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    // On Windows, listen for raw input since SIGINT is unreliable
    if (process.platform === 'win32') {
      process.stdin.resume()
      process.stdin.setRawMode?.(true)
      process.stdin.on('data', (data) => {
        // Ctrl-C is byte 0x03
        if (data[0] === 0x03) void shutdown()
      })
    }
  })

program
  .command('schedule')
  .description('View the current posting schedule across platforms')
  .option('--platform <name>', 'Filter by platform (tiktok, youtube, instagram, linkedin, twitter)')
  .action(async (opts) => {
    await runSchedule({ platform: opts.platform })
    process.exit(0)
  })

program
  .command('doctor')
  .description('Check all prerequisites and dependencies')
  .action(async () => {
    runDoctor()
  })

// --- Default command (process video or watch) ---
// This must come after subcommands so they take priority

const defaultCmd = program
  .command('process', { isDefault: true })
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
  .option('--no-social-publish', 'Skip social media publishing/queue-build stage')
  .option('--late-api-key <key>', 'Late API key (default: env LATE_API_KEY)')
  .option('--late-profile-id <id>', 'Late profile ID (default: env LATE_PROFILE_ID)')
  .option('-v, --verbose', 'Verbose logging')
  .option('--doctor', 'Check all prerequisites and exit')
  .action(async (videoPath: string | undefined) => {
    const opts = defaultCmd.opts()

    // Handle --doctor before anything else
    if (opts.doctor) {
      await runDoctor()
      process.exit(0)
    }

    const onceMode: boolean = opts.once || !!videoPath

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
      socialPublish: opts.socialPublish,
      lateApiKey: opts.lateApiKey,
      lateProfileId: opts.lateProfileId,
    }

    logger.info(BANNER)
    initConfig(cliOptions)
    if (opts.verbose) setVerbose()
    validateRequiredKeys()

    const config = getConfig()
    logger.info(`Watch folder: ${config.WATCH_FOLDER}`)
    logger.info(`Output dir:   ${config.OUTPUT_DIR}`)

    // Direct file mode
    if (videoPath) {
      const resolvedPath = path.resolve(videoPath)
      logger.info(`Processing single video: ${resolvedPath}`)
      await processVideoSafe(resolvedPath)
      logger.info('Done.')
      process.exit(0)
    }

    // Watch mode
    const watcher = new FileWatcher()
    let processing = false
    let shutdownRequested = false
    const queue: string[] = []

    async function processQueue(): Promise<void> {
      if (processing || queue.length === 0) return
      processing = true
      try {
        while (queue.length > 0) {
          const vp = queue.shift()!
          logger.info(`Processing video: ${vp}`)
          await processVideoSafe(vp)
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

    async function shutdown(): Promise<void> {
      if (shutdownRequested) return
      shutdownRequested = true
      logger.info('Shutting down...')
      watcher.stop()
      while (processing) await new Promise(r => setTimeout(r, 500))
      logger.info('Goodbye.')
      process.exit(0)
    }

    process.on('SIGINT', () => shutdown())
    process.on('SIGTERM', () => shutdown())

    watcher.on('new-video', (filePath: string) => {
      queue.push(filePath)
      logger.info(`Queued video: ${filePath} (queue length: ${queue.length})`)
      processQueue().catch(err => logger.error('Queue processing error:', err))
    })
    watcher.start()

    if (onceMode) {
      logger.info('Running in --once mode. Will exit after processing the next video.')
    } else {
      logger.info('Watching for new videos. Press Ctrl+C to stop.')
    }
  })

program.parse()
