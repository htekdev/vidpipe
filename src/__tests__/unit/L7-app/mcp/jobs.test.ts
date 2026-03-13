import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (L1 infra) ────────────────────────────────────────────────────

vi.mock('../../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const mockReadJsonFile = vi.hoisted(() => vi.fn())
const mockWriteJsonFile = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn())
vi.mock('../../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readJsonFile: mockReadJsonFile,
  writeJsonFile: mockWriteJsonFile,
  fileExists: mockFileExists,
}))

vi.mock('../../../../L1-infra/paths/paths.js', () => ({
  join: (...parts: string[]) => parts.join('/'),
  homedir: () => '/home/testuser',
}))

// ── Import after mocks ────────────────────────────────────────────────

import { createJob, getJob, updateJob, cancelJob, listJobs, cleanupOldJobs } from '../../../../L7-app/mcp/jobs.js'

// ── Lifecycle ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  // Default: file exists with empty store — tests that need data override readJsonFile
  mockFileExists.mockResolvedValue(true)
  mockWriteJsonFile.mockResolvedValue(undefined)
  mockReadJsonFile.mockResolvedValue({ jobs: {} })
})

// ── Tests ─────────────────────────────────────────────────────────────

describe('MCP Job Tracker', () => {
  describe('createJob', () => {
    it('creates a job with pending status and unique ID', async () => {
      const job = await createJob('process_video')

      expect(job.id).toMatch(/^job-/)
      expect(job.type).toBe('process_video')
      expect(job.status).toBe('pending')
      expect(job.createdAt).toBeDefined()
      expect(job.heartbeat).toBeDefined()
      expect(mockWriteJsonFile).toHaveBeenCalledOnce()
    })

    it('persists job to disk', async () => {
      await createJob('transcribe_video')

      const writeCall = mockWriteJsonFile.mock.calls[0]
      expect(writeCall[0]).toBe('/home/testuser/.vidpipe/mcp-jobs.json')
      const data = writeCall[1]
      expect(Object.keys(data.jobs)).toHaveLength(1)
    })
  })

  describe('getJob', () => {
    it('returns null for unknown job ID', async () => {
      const job = await getJob('nonexistent')
      expect(job).toBeNull()
    })

    it('returns the job when found', async () => {
      const now = new Date().toISOString()
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'job-123': {
            id: 'job-123',
            type: 'process_video',
            status: 'completed',
            createdAt: now,
            updatedAt: now,
            heartbeat: now,
          },
        },
      })

      const job = await getJob('job-123')
      expect(job).not.toBeNull()
      expect(job!.id).toBe('job-123')
      expect(job!.status).toBe('completed')
    })

    it('marks running jobs as failed when heartbeat is stale', async () => {
      const staleTime = new Date(Date.now() - 3 * 60 * 1000).toISOString() // 3 min ago
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'job-stale': {
            id: 'job-stale',
            type: 'process_video',
            status: 'running',
            createdAt: staleTime,
            updatedAt: staleTime,
            heartbeat: staleTime,
          },
        },
      })

      const job = await getJob('job-stale')
      expect(job!.status).toBe('failed')
      expect(job!.error).toContain('stale')
      expect(mockWriteJsonFile).toHaveBeenCalled()
    })
  })

  describe('updateJob', () => {
    it('updates job status and progress', async () => {
      const now = new Date().toISOString()
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'job-1': {
            id: 'job-1',
            type: 'process_video',
            status: 'pending',
            createdAt: now,
            updatedAt: now,
            heartbeat: now,
          },
        },
      })

      const updated = await updateJob('job-1', {
        status: 'running',
        stage: 'transcription',
        progress: '2/15 stages',
      })

      expect(updated!.status).toBe('running')
      expect(updated!.stage).toBe('transcription')
      expect(updated!.progress).toBe('2/15 stages')
    })

    it('returns null for unknown job ID', async () => {
      const result = await updateJob('nonexistent', { status: 'running' })
      expect(result).toBeNull()
    })
  })

  describe('cancelJob', () => {
    it('sets job status to cancelled', async () => {
      const now = new Date().toISOString()
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'job-cancel': {
            id: 'job-cancel',
            type: 'process_video',
            status: 'running',
            createdAt: now,
            updatedAt: now,
            heartbeat: now,
          },
        },
      })

      const job = await cancelJob('job-cancel')
      expect(job!.status).toBe('cancelled')
      expect(job!.error).toBe('Cancelled by user')
    })
  })

  describe('listJobs', () => {
    it('returns all jobs sorted by creation time (newest first)', async () => {
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'job-old': { id: 'job-old', type: 'a', status: 'completed', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', heartbeat: '2026-01-01T00:00:00Z' },
          'job-new': { id: 'job-new', type: 'b', status: 'running', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z', heartbeat: '2026-03-01T00:00:00Z' },
        },
      })

      const jobs = await listJobs()
      expect(jobs).toHaveLength(2)
      expect(jobs[0].id).toBe('job-new')
    })

    it('filters by status', async () => {
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'job-1': { id: 'job-1', type: 'a', status: 'completed', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', heartbeat: '2026-01-01T00:00:00Z' },
          'job-2': { id: 'job-2', type: 'b', status: 'running', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z', heartbeat: '2026-03-01T00:00:00Z' },
        },
      })

      const jobs = await listJobs({ status: 'running' })
      expect(jobs).toHaveLength(1)
      expect(jobs[0].id).toBe('job-2')
    })
  })

  describe('cleanupOldJobs', () => {
    it('removes jobs older than maxAge that are not running', async () => {
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
      const recent = new Date().toISOString()
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'old-done': { id: 'old-done', type: 'a', status: 'completed', createdAt: old, updatedAt: old, heartbeat: old },
          'old-running': { id: 'old-running', type: 'b', status: 'running', createdAt: old, updatedAt: old, heartbeat: old },
          'recent': { id: 'recent', type: 'c', status: 'completed', createdAt: recent, updatedAt: recent, heartbeat: recent },
        },
      })

      const removed = await cleanupOldJobs()
      expect(removed).toBe(1) // old-done removed, old-running kept (running), recent kept (new)
    })
  })
})
