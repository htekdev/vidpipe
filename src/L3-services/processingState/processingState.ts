import { readJsonFile, writeJsonFile, fileExistsSync } from '../../L1-infra/fileSystem/fileSystem.js'
import { join } from '../../L1-infra/paths/paths.js'
import { getConfig } from '../../L1-infra/config/environment.js'
import logger from '../../L1-infra/logger/configLogger.js'

// ── Types ────────────────────────────────────────────────────────────────────

export type VideoStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface VideoState {
  status: VideoStatus
  sourcePath: string
  startedAt?: string
  completedAt?: string
  error?: string
}

export interface ProcessingStateData {
  videos: Record<string, VideoState>
}

// ── State file path ──────────────────────────────────────────────────────────

function getStatePath(): string {
  const config = getConfig()
  return join(config.OUTPUT_DIR, 'processing-state.json')
}

// ── Read / Write ─────────────────────────────────────────────────────────────

async function readState(): Promise<ProcessingStateData> {
  const statePath = getStatePath()
  if (!fileExistsSync(statePath)) {
    return { videos: {} }
  }
  return readJsonFile<ProcessingStateData>(statePath, { videos: {} })
}

async function writeState(state: ProcessingStateData): Promise<void> {
  const statePath = getStatePath()
  await writeJsonFile(statePath, state)
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Get the processing status for a specific video slug. */
export async function getVideoStatus(slug: string): Promise<VideoState | undefined> {
  const state = await readState()
  return state.videos[slug]
}

/** Get all videos with a specific status. */
export async function getVideosByStatus(status: VideoStatus): Promise<Record<string, VideoState>> {
  const state = await readState()
  const result: Record<string, VideoState> = {}
  for (const [slug, video] of Object.entries(state.videos)) {
    if (video.status === status) {
      result[slug] = video
    }
  }
  return result
}

/** Get all unprocessed videos (pending or failed). */
export async function getUnprocessed(): Promise<Record<string, VideoState>> {
  const state = await readState()
  const result: Record<string, VideoState> = {}
  for (const [slug, video] of Object.entries(state.videos)) {
    if (video.status === 'pending' || video.status === 'failed') {
      result[slug] = video
    }
  }
  return result
}

/** Check if a video has been completed. */
export async function isCompleted(slug: string): Promise<boolean> {
  const status = await getVideoStatus(slug)
  return status?.status === 'completed'
}

/** Mark a video as pending (queued for processing). */
export async function markPending(slug: string, sourcePath: string): Promise<void> {
  const state = await readState()
  state.videos[slug] = {
    status: 'pending',
    sourcePath,
  }
  await writeState(state)
  logger.info(`[ProcessingState] Marked pending: ${slug}`)
}

/** Mark a video as currently processing. */
export async function markProcessing(slug: string): Promise<void> {
  const state = await readState()
  const existing = state.videos[slug]
  if (!existing) {
    logger.warn(`[ProcessingState] Cannot mark processing — unknown slug: ${slug}`)
    return
  }
  state.videos[slug] = {
    ...existing,
    status: 'processing',
    startedAt: new Date().toISOString(),
  }
  await writeState(state)
  logger.info(`[ProcessingState] Marked processing: ${slug}`)
}

/** Mark a video as completed. */
export async function markCompleted(slug: string): Promise<void> {
  const state = await readState()
  const existing = state.videos[slug]
  if (!existing) {
    logger.warn(`[ProcessingState] Cannot mark completed — unknown slug: ${slug}`)
    return
  }
  state.videos[slug] = {
    ...existing,
    status: 'completed',
    completedAt: new Date().toISOString(),
    error: undefined,
  }
  await writeState(state)
  logger.info(`[ProcessingState] Marked completed: ${slug}`)
}

/** Mark a video as failed with an error message. */
export async function markFailed(slug: string, error: string): Promise<void> {
  const state = await readState()
  const existing = state.videos[slug]
  if (!existing) {
    logger.warn(`[ProcessingState] Cannot mark failed — unknown slug: ${slug}`)
    return
  }
  state.videos[slug] = {
    ...existing,
    status: 'failed',
    completedAt: new Date().toISOString(),
    error,
  }
  await writeState(state)
  logger.info(`[ProcessingState] Marked failed: ${slug} — ${error}`)
}

/** Get the full state (for debugging/inspection). */
export async function getFullState(): Promise<ProcessingStateData> {
  return readState()
}
