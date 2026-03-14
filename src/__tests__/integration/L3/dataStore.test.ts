import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import {
  closeDatabase,
  getDatabase,
  initializeDatabase,
  resetDatabaseSingleton,
} from '../../../L1-infra/database/index.js'
import {
  clearAccountCache,
  getCacheAge,
  getCachedAccounts,
  setCachedAccounts,
} from '../../../L2-clients/dataStore/accountCacheStore.js'
import {
  getRunCosts,
  getRunSummary,
  recordLLMCost,
  recordServiceCost,
} from '../../../L2-clients/dataStore/costStore.js'
import {
  completePipelineRun,
  createPipelineRun,
  failPipelineRun,
  getPipelineRun,
  getRecentRuns,
  getRunsBySlug,
} from '../../../L2-clients/dataStore/pipelineRunStore.js'
import {
  getItemsByStatus,
  getQueueItem,
  insertQueueItem,
  markPublished,
} from '../../../L2-clients/dataStore/queueStore.js'
import type { QueueItemInsert } from '../../../L2-clients/dataStore/queueStore.js'
import {
  getVideo,
  isVideoCompleted,
  updateVideoStatus,
  upsertVideo,
} from '../../../L2-clients/dataStore/videoStore.js'

function clearStoreTables(): void {
  const db = getDatabase()
  db.exec(`
    DELETE FROM cost_records;
    DELETE FROM pipeline_runs;
    DELETE FROM queue_items;
    DELETE FROM account_cache;
    DELETE FROM videos;
    DELETE FROM sqlite_sequence WHERE name = 'cost_records';
  `)
}

function createQueueItem(overrides: Partial<QueueItemInsert> = {}): QueueItemInsert {
  return {
    id: 'queue-item-1',
    platform: 'youtube',
    account_id: 'acct-1',
    source_video: 'video-lifecycle',
    source_clip: null,
    clip_type: 'video',
    source_media_path: 'C:\\publish\\video-lifecycle.mp4',
    media_type: 'video',
    hashtags: ['vidpipe', 'database'],
    links: [{ url: 'https://example.com/video-lifecycle', title: 'Lifecycle video' }],
    character_count: 140,
    platform_char_limit: 5000,
    suggested_slot: '2026-03-01T10:00:00Z',
    scheduled_for: null,
    status: 'pending_review',
    late_post_id: null,
    published_url: null,
    post_content: 'Database-backed queue item',
    text_only: false,
    platform_specific: { visibility: 'public' },
    media_folder_path: 'C:\\publish\\video-lifecycle',
    ...overrides,
  }
}

beforeAll(() => {
  closeDatabase()
  resetDatabaseSingleton()
  initializeDatabase({ inMemory: true })
})

afterAll(() => {
  closeDatabase()
  resetDatabaseSingleton()
})

describe('L3 Integration: dataStore video lifecycle', () => {
  beforeEach(() => {
    clearStoreTables()
  })

  afterEach(() => {
    clearStoreTables()
  })

  test('inserts a video, moves it to processing, completes it, and preserves timestamps', () => {
    upsertVideo('video-lifecycle', 'C:\\videos\\video-lifecycle.mp4', 'pending')

    updateVideoStatus('video-lifecycle', 'processing', {
      startedAt: '2026-03-01T09:00:00.000Z',
    })
    updateVideoStatus('video-lifecycle', 'completed', {
      completedAt: '2026-03-01T09:12:00.000Z',
    })

    expect(getVideo('video-lifecycle')).toMatchObject({
      slug: 'video-lifecycle',
      source_path: 'C:\\videos\\video-lifecycle.mp4',
      status: 'completed',
      started_at: '2026-03-01T09:00:00.000Z',
      completed_at: '2026-03-01T09:12:00.000Z',
      error: null,
    })
    expect(isVideoCompleted('video-lifecycle')).toBe(true)
  })
})

describe('L3 Integration: dataStore queue item flow', () => {
  beforeEach(() => {
    clearStoreTables()
  })

  afterEach(() => {
    clearStoreTables()
  })

  test('inserts a queue item, finds it by status, marks it published, and persists publishing metadata', () => {
    insertQueueItem(createQueueItem())

    expect(getItemsByStatus('pending_review').map((item) => item.id)).toEqual(['queue-item-1'])

    markPublished('queue-item-1', {
      latePostId: 'late-post-123',
      scheduledFor: '2026-03-02T14:00:00Z',
      publishedUrl: 'https://late.example/posts/late-post-123',
      accountId: 'acct-published',
    })

    expect(getItemsByStatus('published').map((item) => item.id)).toEqual(['queue-item-1'])
    expect(getQueueItem('queue-item-1')).toMatchObject({
      status: 'published',
      late_post_id: 'late-post-123',
      scheduled_for: '2026-03-02T14:00:00Z',
      published_url: 'https://late.example/posts/late-post-123',
      account_id: 'acct-published',
    })
  })
})

describe('L3 Integration: dataStore cost tracking flow', () => {
  beforeEach(() => {
    clearStoreTables()
  })

  afterEach(() => {
    clearStoreTables()
  })

  test('records LLM and service costs and aggregates them into a run summary', () => {
    recordLLMCost({
      runId: 'run-costs-1',
      provider: 'openai',
      model: 'gpt-5.1',
      agent: 'SummaryAgent',
      stage: 'summary',
      inputTokens: 400,
      outputTokens: 100,
      totalTokens: 500,
      costAmount: 1.25,
      costUnit: 'usd',
      durationMs: 1800,
    })
    recordServiceCost({
      runId: 'run-costs-1',
      service: 'web-search',
      stage: 'social-media',
      costAmount: 0.4,
      metadata: { query: 'video notes', resultCount: 2 },
    })

    expect(getRunCosts('run-costs-1')).toHaveLength(2)
    expect(getRunSummary('run-costs-1')).toEqual({
      totalCostUSD: 1.65,
      totalPRUs: 0,
      totalTokens: {
        input: 400,
        output: 100,
        total: 500,
      },
      llmCalls: 1,
      serviceCalls: 1,
    })
  })
})

describe('L3 Integration: dataStore pipeline run flow', () => {
  beforeEach(() => {
    clearStoreTables()
  })

  afterEach(() => {
    clearStoreTables()
  })

  test('creates a run, completes it, and stores serialized stage results for the associated slug', () => {
    upsertVideo('pipeline-video', 'C:\\videos\\pipeline-video.mp4', 'processing')

    createPipelineRun('run-pipeline-1', 'pipeline-video')
    completePipelineRun(
      'run-pipeline-1',
      [
        { stage: 'ingestion', status: 'completed', durationMs: 120 },
        { stage: 'transcription', status: 'completed', durationMs: 480 },
      ],
      600,
    )

    const run = getPipelineRun('run-pipeline-1')

    expect(run).toMatchObject({
      run_id: 'run-pipeline-1',
      slug: 'pipeline-video',
      status: 'completed',
      total_duration: 600,
      error: null,
    })
    expect(run?.completed_at).toBeTruthy()
    expect(JSON.parse(run?.stage_results ?? '[]')).toEqual([
      { stage: 'ingestion', status: 'completed', durationMs: 120 },
      { stage: 'transcription', status: 'completed', durationMs: 480 },
    ])
    expect(getRunsBySlug('pipeline-video').map((row) => row.run_id)).toEqual(['run-pipeline-1'])
  })

  test('fails a run with error and partial stage results', () => {
    upsertVideo('fail-video', 'C:\\videos\\fail-video.mp4', 'processing')
    createPipelineRun('run-fail-1', 'fail-video')
    failPipelineRun('run-fail-1', 'disk full', [
      { stage: 'ingestion', status: 'completed', durationMs: 100 },
    ])

    const run = getPipelineRun('run-fail-1')
    expect(run).toMatchObject({
      run_id: 'run-fail-1',
      slug: 'fail-video',
      status: 'failed',
      error: 'disk full',
    })
    expect(run?.completed_at).toBeTruthy()
    expect(JSON.parse(run?.stage_results ?? '[]')).toEqual([
      { stage: 'ingestion', status: 'completed', durationMs: 100 },
    ])
  })

  test('fails a run without stage results', () => {
    upsertVideo('fail-video-2', 'C:\\videos\\fail-video-2.mp4', 'processing')
    createPipelineRun('run-fail-2', 'fail-video-2')
    failPipelineRun('run-fail-2', 'out of memory')

    const run = getPipelineRun('run-fail-2')
    expect(run).toMatchObject({
      status: 'failed',
      error: 'out of memory',
    })
    expect(run?.stage_results).toBeNull()
  })

  test('getRecentRuns returns runs ordered by started_at descending', () => {
    upsertVideo('recent-video', 'C:\\videos\\recent.mp4', 'completed')
    createPipelineRun('run-recent-1', 'recent-video')
    completePipelineRun('run-recent-1', [], 100)
    createPipelineRun('run-recent-2', 'recent-video')
    completePipelineRun('run-recent-2', [], 200)

    const runs = getRecentRuns(10)
    const ids = runs.map(r => r.run_id)
    expect(ids).toContain('run-recent-1')
    expect(ids).toContain('run-recent-2')
  })
})

describe('L3 Integration: dataStore account cache flow', () => {
  beforeEach(() => {
    clearStoreTables()
  })

  afterEach(() => {
    clearStoreTables()
  })

  test('returns cached accounts within TTL and null after the cache is expired', () => {
    setCachedAccounts({ youtube: 'acct-youtube', x: 'acct-x' })

    expect(getCachedAccounts(60_000)).toEqual({
      youtube: 'acct-youtube',
      x: 'acct-x',
    })
    expect(getCacheAge()).not.toBeNull()

    getDatabase()
      .prepare('UPDATE account_cache SET fetched_at = ? WHERE platform = ?')
      .run('2000-01-01 00:00:00', 'youtube')

    expect(getCachedAccounts(60_000)).toBeNull()

    clearAccountCache()
    expect(getCachedAccounts(60_000)).toEqual({})
    expect(getCacheAge()).toBeNull()
  })
})

describe('L3 Integration: dataStore cross-store flow', () => {
  beforeEach(() => {
    clearStoreTables()
  })

  afterEach(() => {
    clearStoreTables()
  })

  test('links a video, pipeline run, and recorded costs through slug and runId', () => {
    const slug = 'cross-store-video'
    const runId = 'run-cross-store-1'

    upsertVideo(slug, 'C:\\videos\\cross-store-video.mp4', 'processing')
    createPipelineRun(runId, slug)
    recordLLMCost({
      runId,
      provider: 'copilot',
      model: 'claude-sonnet-4.5',
      agent: 'ShortsAgent',
      stage: 'shorts',
      inputTokens: 250,
      outputTokens: 75,
      totalTokens: 325,
      costAmount: 2,
      costUnit: 'premium_requests',
    })
    recordServiceCost({
      runId,
      service: 'ffmpeg',
      stage: 'caption-burn',
      costAmount: 0.15,
      metadata: { preset: 'medium' },
    })
    completePipelineRun(runId, [{ stage: 'shorts', status: 'completed' }], 910)
    updateVideoStatus(slug, 'completed', { completedAt: '2026-03-03T11:15:00.000Z' })

    expect(getVideo(slug)).toMatchObject({
      slug,
      status: 'completed',
    })
    expect(getRunsBySlug(slug)).toEqual([
      expect.objectContaining({
        run_id: runId,
        slug,
        status: 'completed',
      }),
    ])
    expect(getRunCosts(runId)).toEqual([
      expect.objectContaining({
        run_id: runId,
        record_type: 'llm',
      }),
      expect.objectContaining({
        run_id: runId,
        record_type: 'service',
      }),
    ])
    expect(getRunSummary(runId)).toEqual({
      totalCostUSD: 0.15,
      totalPRUs: 2,
      totalTokens: {
        input: 250,
        output: 75,
        total: 325,
      },
      llmCalls: 1,
      serviceCalls: 1,
    })
  })
})
