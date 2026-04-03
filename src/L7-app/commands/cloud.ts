import { Command } from '../../L1-infra/cli/cli.js'
import { initConfig, getConfig } from '../../L1-infra/config/environment.js'
import { basename, dirname } from 'node:path'
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
    .command('push-output [slug]')
    .description('Upload recording output to Azure Storage')
    .action(async (slug: string | undefined) => {
      console.log(`push-output${slug ? ` ${slug}` : ''}: Not yet implemented`)
      process.exit(0)
    })

  cloud
    .command('migrate')
    .description('Upload existing local publish-queue/ and published/ content to Azure Storage')
    .action(async () => {
      initConfig({})
      const config = getConfig()
      const outputDir = config.OUTPUT_DIR

      logger.info(`Migrating local content from ${outputDir} to Azure Storage...`)
      try {
        const { migrateLocalContent } = await import('../../L3-services/azureStorage/azureStorageService.js')
        const result = await migrateLocalContent(outputDir)
        logger.info(`✅ Migration complete: ${result.uploaded} file(s) uploaded`)
        if (result.errors.length > 0) {
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
    .description('Show Azure connection status, stored config files, and content counts')
    .action(async () => {
      initConfig({})

      try {
        const { isAzureConfigured, getContentItems, listVideos } =
          await import('../../L3-services/azureStorage/azureStorageService.js')
        const { listConfigFiles } =
          await import('../../L3-services/azureStorage/azureConfigService.js')

        const configured = isAzureConfigured()
        console.log(`\n☁️  Azure Storage Status\n`)
        console.log(`  Connection: ${configured ? '✅ Configured' : '❌ Not configured'}`)

        if (!configured) {
          console.log('\n  Run `vidpipe configure set credentials.azureStorageAccountName <name>` and\n  `vidpipe configure set credentials.azureStorageAccountKey <key>` to configure.\n')
          process.exit(0)
          return
        }

        const [configFiles, contentItems, videos] = await Promise.all([
          listConfigFiles(),
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
        logger.error(`Failed to check Azure status: ${msg}`)
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
        const { uploadVideoFile, isAzureConfigured, getRunId } =
          await import('../../L3-services/azureStorage/azureStorageService.js')

        if (!isAzureConfigured()) {
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
    .description('Download a video from Azure blob (blob://) or HTTP URL')
    .action(async (videoUrl: string, outputPath: string) => {
      initConfig({})

      try {
        if (videoUrl.startsWith(BLOB_PREFIX)) {
          const blobPath = videoUrl.slice(BLOB_PREFIX.length)
          logger.info(`Downloading from Azure blob: ${blobPath}`)
          const { downloadBlobToFile } = await import('../../L3-services/azureStorage/azureStorageService.js')
          await downloadBlobToFile(blobPath, outputPath)
        } else {
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
