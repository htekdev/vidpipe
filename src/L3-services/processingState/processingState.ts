import {
  getAllVideos,
  getUnprocessedVideos,
  getVideo,
  getVideosByStatus as dbGetByStatus,
  updateVideoStatus,
  upsertVideo,
} from '../../L2-clients/dataStore/videoStore.js'
import type { VideoRow } from '../../L2-clients/dataStore/videoStore.js'

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

function rowToState(row: VideoRow): VideoState {
  return {
    status: row.status,
    sourcePath: row.source_path,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    error: row.error ?? undefined,
  }
}

function rowsToStateRecord(rows: readonly VideoRow[]): Record<string, VideoState> {
  return rows.reduce<Record<string, VideoState>>((videos, row) => {
    videos[row.slug] = rowToState(row)
    return videos
  }, {})
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Get the processing status for a specific video slug. */
export async function getVideoStatus(slug: string): Promise<VideoState | undefined> {
  const row = getVideo(slug)
  return row ? rowToState(row) : undefined
}

/** Get all videos with a specific status. */
export async function getVideosByStatus(status: VideoStatus): Promise<Record<string, VideoState>> {
  return rowsToStateRecord(dbGetByStatus(status))
}

/** Get all unprocessed videos (pending or failed). */
export async function getUnprocessed(): Promise<Record<string, VideoState>> {
  return rowsToStateRecord(getUnprocessedVideos())
}

/** Check if a video has been completed. */
export async function isCompleted(slug: string): Promise<boolean> {
  const row = getVideo(slug)
  return row?.status === 'completed'
}

/** Mark a video as pending (queued for processing). */
export async function markPending(slug: string, sourcePath: string): Promise<void> {
  upsertVideo(slug, sourcePath, 'pending')
}

/** Mark a video as currently processing. */
export async function markProcessing(slug: string): Promise<void> {
  updateVideoStatus(slug, 'processing', { startedAt: new Date().toISOString() })
}

/** Mark a video as completed. */
export async function markCompleted(slug: string): Promise<void> {
  updateVideoStatus(slug, 'completed', { completedAt: new Date().toISOString() })
}

/** Mark a video as failed with an error message. */
export async function markFailed(slug: string, error: string): Promise<void> {
  updateVideoStatus(slug, 'failed', {
    completedAt: new Date().toISOString(),
    error,
  })
}

/** Get the full state (for debugging/inspection). */
export async function getFullState(): Promise<ProcessingStateData> {
  return { videos: rowsToStateRecord(getAllVideos()) }
}
