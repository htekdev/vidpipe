import type { DatabaseSync } from 'node:sqlite'
import type { Migration } from '../migrations.js'

const migration: Migration = {
  version: 1,
  name: 'initial-schema',
  up(db: DatabaseSync) {
    // ── Videos ───────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE videos (
        slug          TEXT PRIMARY KEY,
        source_path   TEXT NOT NULL,
        status        TEXT NOT NULL CHECK (status IN ('pending','processing','completed','failed')),
        started_at    TEXT,
        completed_at  TEXT,
        error         TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    db.exec('CREATE INDEX idx_videos_status ON videos(status)')

    // ── Queue Items ──────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE queue_items (
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
    db.exec('CREATE INDEX idx_queue_status ON queue_items(status)')
    db.exec('CREATE INDEX idx_queue_platform ON queue_items(platform)')
    db.exec('CREATE INDEX idx_queue_source_video ON queue_items(source_video)')

    // ── Cost Records ─────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE cost_records (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id          TEXT NOT NULL,
        timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
        record_type     TEXT NOT NULL CHECK (record_type IN ('llm','service')),
        provider        TEXT,
        model           TEXT,
        agent           TEXT,
        stage           TEXT,
        input_tokens    INTEGER,
        output_tokens   INTEGER,
        total_tokens    INTEGER,
        cost_amount     REAL NOT NULL,
        cost_unit       TEXT NOT NULL,
        duration_ms     INTEGER,
        service_name    TEXT,
        metadata        TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    db.exec('CREATE INDEX idx_cost_run_id ON cost_records(run_id)')
    db.exec('CREATE INDEX idx_cost_provider ON cost_records(provider)')
    db.exec('CREATE INDEX idx_cost_agent ON cost_records(agent)')
    db.exec('CREATE INDEX idx_cost_timestamp ON cost_records(timestamp)')

    // ── Pipeline Runs ────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE pipeline_runs (
        run_id          TEXT PRIMARY KEY,
        slug            TEXT NOT NULL,
        status          TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
        started_at      TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at    TEXT,
        stage_results   TEXT,
        total_duration  REAL,
        error           TEXT,
        FOREIGN KEY (slug) REFERENCES videos(slug)
      )
    `)
    db.exec('CREATE INDEX idx_runs_slug ON pipeline_runs(slug)')
    db.exec('CREATE INDEX idx_runs_status ON pipeline_runs(status)')

    // ── Account Cache ────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE account_cache (
        platform    TEXT PRIMARY KEY,
        account_id  TEXT NOT NULL,
        fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
  },
}

export default migration
