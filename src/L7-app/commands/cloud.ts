import { Command } from '../../L1-infra/cli/cli.js'
import { initConfig, getConfig } from '../../L1-infra/config/environment.js'
import { basename, dirname, join } from 'node:path'
import { stat as fileStat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import logger from '../../L1-infra/logger/configLogger.js'

const BLOB_PREFIX = 'blob://'

/** The vidpipe working directory — parent of OUTPUT_DIR (e.g., C:\VidPipe) */
function getVidpipeDir(): string {
  const config = getConfig()
  return dirname(config.OUTPUT_DIR)
}

export function createCloudCommand(): Command {
  const cloud = new Command('cloud')
    .description('Manage cloud storage — sync config, migrate content, check status')

  cloud
    .command('push-config')
    .description('Upload config files (schedule.json, brand.json, assets/) to Azure Storage')
    .action(async () => {
      initConfig({})
      const sourceDir = getVidpipeDir()

      logger.info(`Pushing config from ${sourceDir} to Azure Storage...`)
      try {
        const { getStorageProviderName } = await import('../../L3-services/storage/storageService.js')
        if (getStorageProviderName() !== 'azure') throw new Error('Cloud configuration synchronization is not supported with AWS storage')
        const { pushConfig } = await import('../../L3-services/azureStorage/azureConfigService.js')
        const result = await pushConfig(sourceDir)
        logger.info(`✅ Pushed ${result.uploaded} config file(s) to Azure Storage`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error(`Failed to push config: ${msg}`)
        process.exitCode = 1
      }
      process.exit(process.exitCode ?? 0)
    })

  cloud
    .command('pull-config')
    .description('Download config files from Azure Storage to local directory')
    .action(async () => {
      initConfig({})
      const targetDir = getVidpipeDir()

      logger.info(`Pulling config from Azure Storage to ${targetDir}...`)
      try {
        const { getStorageProviderName } = await import('../../L3-services/storage/storageService.js')
        if (getStorageProviderName() !== 'azure') throw new Error('Cloud configuration synchronization is not supported with AWS storage')
        const { pullConfig } = await import('../../L3-services/azureStorage/azureConfigService.js')
        const result = await pullConfig(targetDir)
        logger.info(`✅ Pulled ${result.downloaded} config file(s) from Azure Storage`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error(`Failed to pull config: ${msg}`)
        process.exitCode = 1
      }
      process.exit(process.exitCode ?? 0)
    })

  cloud
    .command('upload <recording-folder>')
    .description('Upload a recording folder (video + publish-queue) to selected cloud storage')
    .option('--slug <slug>', 'Video slug (auto-derived from folder name if omitted)')
    .action(async (recordingFolder: string, opts: { slug?: string }) => {
      initConfig({})
      const config = getConfig()

      try {
        const { uploadRawVideo, uploadPublishQueue, isStorageConfigured, getStorageProviderName, getRunId } =
          await import('../../L3-services/storage/storageService.js')
        const { readdir, stat: getFileStat } = await import('node:fs/promises')

        if (!isStorageConfigured()) {
          logger.error(`${getStorageProviderName()} storage not configured`)
          process.exit(1)
          return
        }

        // Find the mp4 file in the recording folder
        const files = await readdir(recordingFolder)
        const mp4File = files.find(f => f.endsWith('.mp4'))
        if (!mp4File) {
          logger.error(`No .mp4 file found in ${recordingFolder}`)
          process.exit(1)
          return
        }

        const videoPath = join(recordingFolder, mp4File)
        const folderName = basename(recordingFolder)
        const slug = opts.slug || folderName.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
        const runId = getRunId()

        // Upload raw video
        const stats = await getFileStat(videoPath)
        logger.info(`Uploading ${mp4File} (${(stats.size / 1024 / 1024).toFixed(1)} MB) to ${getStorageProviderName()}...`)
        const blobPath = await uploadRawVideo(videoPath, runId, { slug, originalFilename: mp4File, size: stats.size })
        logger.info(`✅ Raw video uploaded: ${blobPath}`)

        // Upload publish-queue items belonging to this recording
        const publishQueueDir = join(config.OUTPUT_DIR, 'publish-queue')
        logger.info(`Scanning publish-queue for items from ${folderName}...`)

        const { uploaded, errors } = await uploadPublishQueue(publishQueueDir, slug, runId)

        logger.info(`✅ Content uploaded: ${uploaded} item(s)`)
        if (errors.length > 0) {
          process.exitCode = 1
          logger.warn(`   ${errors.length} error(s):`)
          for (const err of errors) {
            logger.warn(`     ⚠ ${err}`)
          }
        }

        logger.info(`Cloud upload complete (runId: ${runId})`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error(`Failed to upload: ${msg}`)
        process.exitCode = 1
      }
      process.exit(process.exitCode ?? 0)
    })

  cloud
    .command('migrate')
    .description('Import local publish-queue/ and published/ into selected cloud storage, skipping existing records')
    .option('--source-dir <path>', 'Source output directory (defaults to OUTPUT_DIR)')
    .option('--dry-run', 'Inspect migration without uploading or modifying records', false)
    .action(async (opts: { sourceDir?: string; dryRun: boolean }) => {
      initConfig({})
      const config = getConfig()
      const outputDir = opts.sourceDir ?? config.OUTPUT_DIR

      logger.info(`${opts.dryRun ? 'Previewing migration' : 'Migrating local content'} from ${outputDir}...`)
      try {
        const { migrateLocalContent } = await import('../../L3-services/storage/storageService.js')
        const result = await migrateLocalContent(outputDir, { dryRun: opts.dryRun })
        logger.info(`✅ Migration ${opts.dryRun ? 'preview' : 'complete'}: ${result.eligible} eligible, ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.invalid} invalid, ${result.failed} failed`)
        if (result.errors.length > 0) {
          process.exitCode = 1
          logger.warn(`   ${result.errors.length} error(s):`)
          for (const err of result.errors) {
            logger.warn(`     ⚠ ${err}`)
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error(`Failed to migrate content: ${msg}`)
        process.exitCode = 1
      }
      process.exit(process.exitCode ?? 0)
    })

  cloud
    .command('status')
    .description('Show selected storage configuration status and content counts')
    .action(async () => {
      initConfig({})

      try {
        const { isStorageConfigured, getStorageProviderName, getContentItems, listVideos } =
          await import('../../L3-services/storage/storageService.js')

        const provider = getStorageProviderName()
        const configured = isStorageConfigured()
        console.log(`\n☁️  ${provider === 'aws' ? 'AWS' : 'Azure'} Storage Status\n`)
        console.log(`  Connection: ${configured ? '✅ Configured' : '❌ Not configured'}`)

        if (!configured) {
          console.log(provider === 'aws'
            ? '\n  Configure aws-region, aws-s3-bucket, aws-dynamodb-content-table and aws-dynamodb-videos-table; authenticate using an AWS profile or role.\n'
            : '\n  Run `vidpipe configure set credentials.azureStorageAccountName <name>` and\n  `vidpipe configure set credentials.azureStorageAccountKey <key>` to configure.\n')
          process.exit(0)
          return
        }

        const [configFiles, contentItems, videos] = await Promise.all([
          provider === 'azure'
            ? import('../../L3-services/azureStorage/azureConfigService.js').then(service => service.listConfigFiles())
            : Promise.resolve([]),
          getContentItems(),
          listVideos(),
        ])

        console.log(`\n  Config files:    ${configFiles.length}`)
        for (const file of configFiles) {
          console.log(`    • ${file}`)
        }

        console.log(`\n  Content items:   ${contentItems.length}`)
        console.log(`  Videos stored:   ${videos.length}`)
        console.log()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error(`Failed to check storage status: ${msg}`)
        process.exitCode = 1
      }
      process.exit(process.exitCode ?? 0)
    })

  cloud
    .command('process <video>')
    .description('Upload video to Azure Storage and trigger GitHub Actions pipeline')
    .option('--spec <spec>', 'Pipeline spec preset')
    .option('--ideas <ids>', 'Comma-separated idea IDs')
    .option('--publish-by <date>', 'Publish-by date (ISO or +Nd)')
    .option('--repo <owner/repo>', 'GitHub repository', 'htekdev/vidpipe')
    .action(async (videoPath: string, opts: { spec?: string; ideas?: string; publishBy?: string; repo: string }) => {
      initConfig({})

      try {
        const { uploadVideoFile, isStorageConfigured, getStorageProviderName, getRunId } =
          await import('../../L3-services/storage/storageService.js')
        if (getStorageProviderName() !== 'azure') throw new Error('Remote cloud processing is not supported with AWS storage')

        if (!isStorageConfigured()) {
          logger.error('Azure Storage not configured. Run `vidpipe configure set credentials.azureStorageAccountName <name>`')
          process.exit(1)
          return
        }

        const filename = basename(videoPath)
        const runId = getRunId()
        const blobPath = `raw/${runId}-${filename}`

        const stats = await fileStat(videoPath)
        logger.info(`Uploading ${filename} (${(stats.size / 1024 / 1024).toFixed(1)} MB) to Azure...`)
        await uploadVideoFile(videoPath, blobPath)
        logger.info(`✅ Uploaded to ${blobPath}`)

        // Trigger GitHub Actions workflow
        const videoUrl = `${BLOB_PREFIX}${blobPath}`
        const args = ['workflow', 'run', 'process-video.yml', '--repo', opts.repo, '-f', `video_url=${videoUrl}`]
        if (opts.spec) args.push('-f', `spec=${opts.spec}`)
        if (opts.ideas) args.push('-f', `ideas=${opts.ideas}`)
        if (opts.publishBy) args.push('-f', `publish_by=${opts.publishBy}`)

        logger.info('Triggering GitHub Actions workflow...')
        await new Promise<void>((resolve, reject) => {
          execFile('gh', args, (err, stdout, stderr) => {
            if (err) {
              reject(new Error(stderr || err.message))
              return
            }
            if (stdout.trim()) logger.info(stdout.trim())
            resolve()
          })
        })
        logger.info(`✅ Workflow triggered. Video: ${videoUrl}`)
        logger.info(`   Monitor at: https://github.com/${opts.repo}/actions`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error(`Failed: ${msg}`)
        process.exitCode = 1
      }
      process.exit(process.exitCode ?? 0)
    })

  cloud
    .command('download <video-url> <output-path>')
    .description('Download media from selected cloud storage (blob:// or s3://) or an HTTP URL')
    .action(async (videoUrl: string, outputPath: string) => {
      initConfig({})

      try {
        if (videoUrl.startsWith(BLOB_PREFIX) || videoUrl.startsWith('s3://')) {
          const { downloadStorageUrlToFile } = await import('../../L3-services/storage/storageService.js')
          await downloadStorageUrlToFile(videoUrl, outputPath)
        } else {
          if (!/^https?:\/\//i.test(videoUrl)) throw new Error('Expected an HTTP, blob://, or s3:// URL')
          logger.info(`Downloading from URL: ${videoUrl}`)
          await new Promise<void>((resolve, reject) => {
            execFile('curl', ['-L', '--fail', '-o', outputPath, videoUrl], (err, _stdout, stderr) => {
              if (err) {
                reject(new Error(stderr || err.message))
                return
              }
              resolve()
            })
          })
        }
        const stats = await fileStat(outputPath)
        logger.info(`✅ Downloaded: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error(`Download failed: ${msg}`)
        process.exitCode = 1
      }
      process.exit(process.exitCode ?? 0)
    })

  return cloud
}
