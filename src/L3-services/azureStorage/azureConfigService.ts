import { readdir, stat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import logger from '../../L1-infra/logger/configLogger.js'
import * as blobClient from '../../L2-clients/azure/blobClient.js'

const CONFIG_PREFIX = 'config/'
const CONFIG_FILES = ['schedule.json', 'brand.json']
const CONFIG_DIRS = ['assets']

export async function pushConfig(vidpipeDir: string): Promise<{ uploaded: number }> {
  let uploaded = 0

  // Upload known config files
  for (const file of CONFIG_FILES) {
    const fullPath = join(vidpipeDir, file)
    try {
      await stat(fullPath)
      const blobPath = `${CONFIG_PREFIX}${file}`
      logger.info(`Uploading ${file}...`)
      await blobClient.uploadFile(blobPath, fullPath)
      uploaded++
      logger.info(`  ✅ ${blobPath}`)
    } catch {
      logger.debug(`Config file not found, skipping: ${file}`)
    }
  }

  // Upload known config directories
  for (const dir of CONFIG_DIRS) {
    const fullPath = join(vidpipeDir, dir)
    try {
      await stat(fullPath)
      logger.info(`Uploading ${dir}/...`)
      const count = await uploadDirectory(fullPath, `${CONFIG_PREFIX}${dir}`)
      uploaded += count
      logger.info(`  ✅ ${dir}/ (${count} files)`)
    } catch {
      logger.debug(`Config directory not found, skipping: ${dir}/`)
    }
  }

  logger.info(`Pushed ${uploaded} config files to Azure`)
  return { uploaded }
}

async function uploadDirectory(localDir: string, blobPrefix: string): Promise<number> {
  let count = 0
  const entries = await readdir(localDir)

  for (const entry of entries) {
    const fullPath = join(localDir, entry)
    const entryStat = await stat(fullPath)

    if (entryStat.isDirectory()) {
      count += await uploadDirectory(fullPath, `${blobPrefix}/${entry}`)
    } else if (entryStat.isFile()) {
      const blobPath = `${blobPrefix}/${entry}`
      await blobClient.uploadFile(blobPath, fullPath)
      count++
    }
  }

  return count
}

export async function pullConfig(targetDir: string): Promise<{ downloaded: number }> {
  let downloaded = 0

  const blobs = await blobClient.listBlobs(CONFIG_PREFIX)

  for (const blobPath of blobs) {
    const relativePath = blobPath.slice(CONFIG_PREFIX.length)
    const localPath = join(targetDir, relativePath)

    // Ensure parent directory exists
    const parentDir = join(localPath, '..')
    await mkdir(parentDir, { recursive: true })

    await blobClient.downloadToFile(blobPath, localPath)
    downloaded++
    logger.debug(`Downloaded config: ${blobPath} → ${localPath}`)
  }

  logger.info(`Pulled ${downloaded} config files from Azure`)
  return { downloaded }
}

export async function listConfigFiles(): Promise<string[]> {
  const blobs = await blobClient.listBlobs(CONFIG_PREFIX)
  return blobs.map(b => b.slice(CONFIG_PREFIX.length))
}
