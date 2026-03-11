import { Command } from '../L1-infra/cli/cli.js'
import { initConfig, validateRequiredKeys, getConfig } from '../L1-infra/config/environment'
import type { CLIOptions } from '../L1-infra/config/environment'
import { FileWatcher } from './fileWatcher'
import { processVideoSafe } from '../L6-pipeline/pipeline'
import logger, { setVerbose } from '../L1-infra/logger/configLogger'
import { runDoctor } from './commands/doctor'
import { runInit } from './commands/init'
import { runSchedule } from './commands/schedule'
import { runRealign } from './commands/realign'
import { runChat } from './commands/chat'
import { startReviewServer } from './review/server'
import { openUrl } from '../L1-infra/cli/cli.js'
import { readTextFileSync, listDirectorySync } from '../L1-infra/fileSystem/fileSystem.js'
import { projectRoot, join, resolve, extname } from '../L1-infra/paths/paths.js'
import { isCompleted, getUnprocessed, getVideoStatus } from '../L3-services/processingState/processingState.js'

const pkg = JSON.parse(readTextFileSync(join(projectRoot(), 'package.json')))

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
    const parsedPort = Number.parseInt(opts.port, 10)
    if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      console.error('Invalid --port value. Must be an integer between 1 and 65535.')
      process.exit(1)
    }
    const { port, close } = await startReviewServer({ port: parsedPort })
    await openUrl(`http://localhost:${port}`)
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
  .command('realign')
  .description('Realign all Late scheduled, cancelled, and failed posts to match schedule.json slots')
  .option('--platform <name>', 'Filter by platform (tiktok, youtube, instagram, linkedin, twitter)')
  .option('--dry-run', 'Preview changes without updating posts')
  .action(async (opts) => {
    await runRealign({ platform: opts.platform, dryRun: opts.dryRun })
    process.exit(0)
  })

program
  .command('chat')
  .description('Interactive chat session with the schedule management agent')
  .action(async () => {
    await runChat()
    process.exit(0)
  })

program
  .command('doctor')
  .description('Check all prerequisites and dependencies')
  .action(async () => {
    await runDoctor()
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
  .option('--no-visual-enhancement', 'Skip visual enhancement (AI image overlays)')
  .option('--no-social-publish','Skip social media publishing/queue-build stage')
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
      visualEnhancement: opts.visualEnhancement,
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
      const resolvedPath = resolve(videoPath)
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

    watcher.on('new-video', async (filePath: string) => {
      // Dedup: skip videos already completed
      const filename = filePath.replace(/\\/g, '/').split('/').pop() ?? ''
      const slug = filename.replace(/\.(mp4|mov|webm|avi|mkv)$/i, '')
      if (slug && await isCompleted(slug)) {
        logger.info(`Skipping already-processed video: ${filePath}`)
        return
      }
      queue.push(filePath)
      logger.info(`Queued video: ${filePath} (queue length: ${queue.length})`)
      processQueue().catch(err => logger.error('Queue processing error:', err))
    })
    watcher.start()

    // Startup reconciliation: scan watch folder for videos not yet tracked
    try {
      const watchFiles = listDirectorySync(config.WATCH_FOLDER)
      for (const file of watchFiles) {
        const ext = extname(file).toLowerCase()
        if (!['.mp4', '.mov', '.webm', '.avi', '.mkv'].includes(ext)) continue
        const filePath = join(config.WATCH_FOLDER, file)
        const slug = file.replace(/\.(mp4|mov|webm|avi|mkv)$/i, '')
        const status = await getVideoStatus(slug)
        if (!status || status.status === 'failed' || status.status === 'pending') {
          if (!queue.includes(filePath)) {
            queue.push(filePath)
            logger.info(`Startup scan: queued ${slug}${status ? ` (was ${status.status})` : ' (new)'}`)
          }
        }
      }
    } catch (err) {
      logger.warn(`Could not scan watch folder on startup: ${err instanceof Error ? err.message : String(err)}`)
    }

    // Also re-queue any videos tracked as unprocessed (pending/failed) from previous runs
    const unprocessed = await getUnprocessed()
    for (const [slug, state] of Object.entries(unprocessed)) {
      if (!queue.includes(state.sourcePath)) {
        queue.push(state.sourcePath)
        logger.info(`Re-queued from state: ${slug} (${state.status})`)
      }
    }

    if (queue.length > 0) {
      logger.info(`Startup: ${queue.length} video(s) queued for processing`)
      processQueue().catch(err => logger.error('Queue processing error:', err))
    }

    if (onceMode) {
      logger.info('Running in --once mode. Will exit after processing the next video.')
    } else {
      logger.info('Watching for new videos. Press Ctrl+C to stop.')
    }
  })

program.parse()
