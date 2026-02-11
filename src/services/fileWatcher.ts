import { watch, FSWatcher } from 'chokidar'
import { getConfig } from '../config/environment'
import { EventEmitter } from 'events'
import path from 'path'
import fs from 'fs'
import logger from '../config/logger'

export interface FileWatcherOptions {
  processExisting?: boolean
}

export class FileWatcher extends EventEmitter {
  private watchFolder: string
  private watcher: FSWatcher | null = null
  private processExisting: boolean

  constructor(options: FileWatcherOptions = {}) {
    super()
    const config = getConfig()
    this.watchFolder = config.WATCH_FOLDER
    this.processExisting = options.processExisting ?? false

    if (!fs.existsSync(this.watchFolder)) {
      fs.mkdirSync(this.watchFolder, { recursive: true })
      logger.info(`Created watch folder: ${this.watchFolder}`)
    }
  }

  private static readonly MIN_FILE_SIZE = 1024 * 1024 // 1MB
  private static readonly EXTRA_STABILITY_DELAY = 3000

  /** Read file size, wait, read again — if it changed the file is still being written. */
  private async isFileStable(filePath: string): Promise<boolean> {
    try {
      const sizeBefore = fs.statSync(filePath).size
      await new Promise((resolve) => setTimeout(resolve, FileWatcher.EXTRA_STABILITY_DELAY))
      const sizeAfter = fs.statSync(filePath).size
      return sizeBefore === sizeAfter
    } catch {
      return false
    }
  }

  private async handleDetectedFile(filePath: string): Promise<void> {
    if (path.extname(filePath).toLowerCase() !== '.mp4') {
      logger.debug(`[watcher] Ignoring non-mp4 file: ${filePath}`)
      return
    }

    let fileSize: number
    try {
      fileSize = fs.statSync(filePath).size
    } catch (err) {
      logger.warn(`[watcher] Could not stat file (may have been removed): ${filePath}`)
      return
    }

    logger.debug(`[watcher] File size: ${(fileSize / 1024 / 1024).toFixed(1)} MB — ${filePath}`)
    if (fileSize < FileWatcher.MIN_FILE_SIZE) {
      logger.warn(`Skipping small file (${fileSize} bytes), likely a failed recording: ${filePath}`)
      return
    }

    const stable = await this.isFileStable(filePath)
    if (!stable) {
      logger.warn(`File is still being written, skipping for now: ${filePath}`)
      return
    }

    logger.info(`New video detected: ${filePath}`)
    this.emit('new-video', filePath)
  }

  private scanExistingFiles(): void {
    let files: string[]
    try {
      files = fs.readdirSync(this.watchFolder)
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        logger.warn(`Watch folder does not exist, skipping scan: ${this.watchFolder}`)
        return
      }
      throw err
    }
    for (const file of files) {
      if (path.extname(file).toLowerCase() === '.mp4') {
        const filePath = path.join(this.watchFolder, file)
        this.handleDetectedFile(filePath).catch(err =>
          logger.error(`Error processing ${filePath}: ${err instanceof Error ? err.message : String(err)}`)
        )
      }
    }
  }

  start(): void {
    this.watcher = watch(this.watchFolder, {
      persistent: true,
      ignoreInitial: true,
      depth: 0,
      atomic: 100,
      // Polling is more reliable on Windows for detecting renames (e.g. Bandicam temp→final)
      usePolling: true,
      interval: 500,
      awaitWriteFinish: {
        stabilityThreshold: 3000,
        pollInterval: 200,
      },
    })

    this.watcher.on('add', (filePath: string) => {
      logger.debug(`[watcher] 'add' event: ${filePath}`)
      this.handleDetectedFile(filePath).catch(err =>
        logger.error(`Error processing ${filePath}: ${err instanceof Error ? err.message : String(err)}`)
      )
    })

    this.watcher.on('change', (filePath: string) => {
      logger.debug(`[watcher] 'change' event: ${filePath}`)
      if (path.extname(filePath).toLowerCase() !== '.mp4') return
      logger.info(`Change detected on video file: ${filePath}`)
      this.handleDetectedFile(filePath).catch(err =>
        logger.error(`Error processing ${filePath}: ${err instanceof Error ? err.message : String(err)}`)
      )
    })

    this.watcher.on('unlink', (filePath: string) => {
      logger.debug(`[watcher] 'unlink' event: ${filePath}`)
    })

    this.watcher.on('raw', (event: string, rawPath: string, details: unknown) => {
      logger.debug(`[watcher] raw event=${event} path=${rawPath}`)
    })

    this.watcher.on('error', (error: unknown) => {
      logger.error(`File watcher error: ${error instanceof Error ? error.message : String(error)}`)
    })

    this.watcher.on('ready', () => {
      logger.info('File watcher is fully initialized and ready')
      if (this.processExisting) {
        this.scanExistingFiles()
      }
    })

    logger.info(`Watching for new .mp4 files in: ${this.watchFolder}`)
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
      logger.info('File watcher stopped')
    }
  }
}
