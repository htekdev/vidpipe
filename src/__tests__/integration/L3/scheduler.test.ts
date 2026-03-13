import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// Mock L1 infrastructure (ESM imports verified)
vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v: unknown) => String(v)),
}))

const mockOutputDir = vi.hoisted(() => {
  const os = require('node:os')
  const path = require('node:path')
  return path.join(os.tmpdir(), 'vidpipe-scheduler-l3-test')
})

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({
    OUTPUT_DIR: mockOutputDir,
    LATE_API_KEY: '',
  }),
  initConfig: vi.fn(),
}))

// Mock L1 database — provide in-memory SQLite so L2 queueStore works
const mockDbInstance = vi.hoisted(() => {
  const { DatabaseSync } = require('node:sqlite')
  return new DatabaseSync(':memory:')
})
vi.mock('../../../L1-infra/database/database.js', () => ({
  getDatabase: () => mockDbInstance,
  closeDatabase: vi.fn(),
  resetDatabaseSingleton: vi.fn(),
}))

import { getScheduleCalendar } from '../../../L3-services/scheduler/scheduler.js'
import { clearScheduleCache } from '../../../L3-services/scheduler/scheduleConfig.js'

describe('L3 Integration: scheduler calendar with no Late API', () => {
  beforeAll(() => {
    // Initialize queue_items table in the in-memory database
    mockDbInstance.exec(`
      CREATE TABLE IF NOT EXISTS queue_items (
        id                  TEXT PRIMARY KEY,
        platform            TEXT NOT NULL,
        account_id          TEXT NOT NULL DEFAULT '',
        source_video        TEXT NOT NULL,
        source_clip         TEXT,
        clip_type           TEXT NOT NULL CHECK (clip_type IN ('video','short','medium-clip')),
        source_media_path   TEXT,
        media_type          TEXT CHECK (media_type IN ('video','image')),
        hashtags            TEXT,
        links               TEXT,
        character_count     INTEGER NOT NULL DEFAULT 0,
        platform_char_limit INTEGER NOT NULL DEFAULT 0,
        suggested_slot      TEXT,
        scheduled_for       TEXT,
        status              TEXT NOT NULL CHECK (status IN ('pending_review','published')),
        late_post_id        TEXT,
        published_url       TEXT,
        post_content        TEXT NOT NULL,
        text_only           INTEGER,
        platform_specific   TEXT,
        media_folder_path   TEXT,
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed_at         TEXT,
        published_at        TEXT
      )
    `)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    clearScheduleCache()
  })

  it('returns empty calendar when Late API is unreachable and no local items', async () => {
    const calendar = await getScheduleCalendar()
    expect(calendar).toEqual([])
  })
})
