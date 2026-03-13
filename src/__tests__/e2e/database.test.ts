import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  closeDatabase,
  getCurrentVersion,
  getDatabase,
  getDatabasePath,
  initializeDatabase,
  resetDatabaseSingleton,
} from '../../L1-infra/database/index.js'
import {
  getRunCosts,
  getRunSummary,
  recordLLMCost,
  recordServiceCost,
} from '../../L2-clients/dataStore/costStore.js'
import { getQueueItem, insertQueueItem } from '../../L2-clients/dataStore/queueStore.js'
import type { QueueItemInsert } from '../../L2-clients/dataStore/queueStore.js'
import { getVideo, upsertVideo } from '../../L2-clients/dataStore/videoStore.js'

let tempDir: string

async function ensureTempDir(): Promise<string> {
  if (!tempDir) {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidpipe-db-e2e-'))
  }

  return tempDir
}

function createQueueItem(overrides: Partial<QueueItemInsert> = {}): QueueItemInsert {
  return {
    id: 'queue-e2e-1',
    platform: 'youtube',
    account_id: 'acct-e2e',
    source_video: 'video-e2e',
    source_clip: 'clip-e2e',
    clip_type: 'short',
    source_media_path: 'C:\\publish\\clip-e2e.mp4',
    media_type: 'video',
    hashtags: ['sqlite', 'roundtrip'],
    links: [{ url: 'https://example.com/e2e', title: 'E2E article' }],
    character_count: 180,
    platform_char_limit: 5000,
    suggested_slot: '2026-03-04T10:30:00Z',
    scheduled_for: null,
    status: 'pending_review',
    late_post_id: null,
    published_url: null,
    post_content: 'Queue item persisted to SQLite',
    text_only: true,
    platform_specific: { thumbnail: 'portrait' },
    media_folder_path: 'C:\\publish\\queue-e2e',
    ...overrides,
  }
}

beforeEach(() => {
  closeDatabase()
  resetDatabaseSingleton()
})

afterEach(() => {
  closeDatabase()
  resetDatabaseSingleton()
})

afterAll(async () => {
  closeDatabase()
  resetDatabaseSingleton()

  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
})

describe('Database E2E', () => {
  test('creates a real SQLite file on disk', async () => {
    const dir = await ensureTempDir()
    const dbPath = path.join(dir, 'creation.sqlite')

    initializeDatabase({ dbPath })

    const stat = await fs.stat(dbPath)

    expect(stat.isFile()).toBe(true)
    expect(getDatabasePath()).toBe(dbPath)
  })

  test('runs migrations and creates all expected tables', async () => {
    const dir = await ensureTempDir()
    const dbPath = path.join(dir, 'migrations.sqlite')

    initializeDatabase({ dbPath })

    const tables = getDatabase()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>

    expect(getCurrentVersion(getDatabase())).toBe(1)
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'account_cache',
        'cost_records',
        'pipeline_runs',
        'queue_items',
        'schema_migrations',
        'sqlite_sequence',
        'videos',
      ]),
    )
  })

  test('persists a video record across close and reopen', async () => {
    const dir = await ensureTempDir()
    const dbPath = path.join(dir, 'videos.sqlite')

    initializeDatabase({ dbPath })
    upsertVideo('video-e2e', 'C:\\videos\\video-e2e.mp4', 'pending')

    closeDatabase()
    resetDatabaseSingleton()

    initializeDatabase({ dbPath })

    expect(getVideo('video-e2e')).toMatchObject({
      slug: 'video-e2e',
      source_path: 'C:\\videos\\video-e2e.mp4',
      status: 'pending',
    })
  })

  test('persists a queue item with JSON fields across close and reopen', async () => {
    const dir = await ensureTempDir()
    const dbPath = path.join(dir, 'queue.sqlite')

    initializeDatabase({ dbPath })
    insertQueueItem(createQueueItem())

    closeDatabase()
    resetDatabaseSingleton()

    initializeDatabase({ dbPath })

    const queueItem = getQueueItem('queue-e2e-1')

    expect(queueItem).toMatchObject({
      id: 'queue-e2e-1',
      status: 'pending_review',
      text_only: 1,
      media_type: 'video',
    })
    expect(queueItem?.hashtags).toBe(JSON.stringify(['sqlite', 'roundtrip']))
    expect(queueItem?.links).toBe(JSON.stringify([{ url: 'https://example.com/e2e', title: 'E2E article' }]))
    expect(queueItem?.platform_specific).toBe(JSON.stringify({ thumbnail: 'portrait' }))
  })

  test('persists recorded costs across close and reopen', async () => {
    const dir = await ensureTempDir()
    const dbPath = path.join(dir, 'costs.sqlite')

    initializeDatabase({ dbPath })
    recordLLMCost({
      runId: 'run-e2e-1',
      provider: 'openai',
      model: 'gpt-5.1',
      agent: 'SummaryAgent',
      stage: 'summary',
      inputTokens: 320,
      outputTokens: 80,
      totalTokens: 400,
      costAmount: 0.9,
      costUnit: 'usd',
      durationMs: 1400,
    })
    recordServiceCost({
      runId: 'run-e2e-1',
      service: 'web-search',
      stage: 'social-media',
      costAmount: 0.35,
      metadata: { query: 'sqlite wal mode' },
    })

    closeDatabase()
    resetDatabaseSingleton()

    initializeDatabase({ dbPath })

    expect(getRunCosts('run-e2e-1')).toHaveLength(2)
    expect(getRunSummary('run-e2e-1')).toEqual({
      totalCostUSD: 1.25,
      totalPRUs: 0,
      totalTokens: {
        input: 320,
        output: 80,
        total: 400,
      },
      llmCalls: 1,
      serviceCalls: 1,
    })
  })

  test('configures SQLite to use WAL journal mode', async () => {
    const dir = await ensureTempDir()
    const dbPath = path.join(dir, 'wal.sqlite')

    initializeDatabase({ dbPath })

    const journalMode = getDatabase().prepare('PRAGMA journal_mode').get() as { journal_mode: string }

    expect(journalMode.journal_mode.toLowerCase()).toBe('wal')
  })
})

// ── L3 Service E2E Tests ──────────────────────────────────────────────────
// These verify L3 services work correctly with a real SQLite database (no mocks)

describe('E2E: L3 services with real SQLite', () => {
  beforeEach(async () => {
    closeDatabase()
    resetDatabaseSingleton()
    const dir = await ensureTempDir()
    const dbPath = path.join(dir, `l3-e2e-${Date.now()}.sqlite`)
    initializeDatabase({ dbPath })
  })

  afterEach(() => {
    closeDatabase()
    resetDatabaseSingleton()
  })

  test('processingState manages video lifecycle through DB', async () => {
    const { markPending, markProcessing, markCompleted, getVideoStatus, isCompleted, getUnprocessed } = await import('../../L3-services/processingState/processingState.js')

    await markPending('e2e-video', '/videos/e2e.mp4')
    const pending = await getVideoStatus('e2e-video')
    expect(pending?.status).toBe('pending')
    expect(pending?.sourcePath).toBe('/videos/e2e.mp4')

    await markProcessing('e2e-video')
    const processing = await getVideoStatus('e2e-video')
    expect(processing?.status).toBe('processing')
    expect(processing?.startedAt).toBeDefined()

    await markCompleted('e2e-video')
    expect(await isCompleted('e2e-video')).toBe(true)

    const unprocessed = await getUnprocessed()
    expect(unprocessed).not.toHaveProperty('e2e-video')
  })

  test('costTracker persists costs to DB via setRunId', async () => {
    const { costTracker } = await import('../../L3-services/costTracking/costTracker.js')

    costTracker.reset()
    costTracker.setRunId('e2e-run-1')
    costTracker.setAgent('TestAgent')
    costTracker.setStage('summary')

    costTracker.recordUsage(
      'openai',
      'gpt-5.1',
      { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      { amount: 0.5, unit: 'usd', model: 'gpt-5.1' },
    )

    // Verify in-memory records exist
    const report = costTracker.getReport()
    expect(report.records).toHaveLength(1)

    // Verify in DB
    const dbCosts = getRunCosts('e2e-run-1')
    expect(dbCosts.length).toBeGreaterThanOrEqual(1)

    costTracker.reset()
  })
})
