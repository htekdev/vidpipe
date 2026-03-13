import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (L1 + L6 only — valid for L7 unit tests) ────────────────────

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

const mockProcessVideoSafe = vi.hoisted(() => vi.fn())
vi.mock('../../../../L6-pipeline/pipeline.js', () => ({
  processVideoSafe: mockProcessVideoSafe,
}))

// ── Import after mocks ────────────────────────────────────────────────

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerPipelineTools } from '../../../../L7-app/mcp/tools/pipeline.js'

// ── Helpers ────────────────────────────────────────────────────────────

let registeredTools: Map<string, { description: string; handler: (args: Record<string, unknown>) => Promise<unknown> }>

function createTestServer(): McpServer {
  registeredTools = new Map()
  const mockServer = {
    tool: vi.fn((name: string, description: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
      registeredTools.set(name, { description, handler })
    }),
  } as unknown as McpServer
  registerPipelineTools(mockServer)
  return mockServer
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const tool = registeredTools.get(name)
  if (!tool) throw new Error(`Tool not found: ${name}`)
  const result = await tool.handler(args) as { content: Array<{ text: string }> }
  return JSON.parse(result.content[0].text)
}

// ── Lifecycle ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockFileExists.mockResolvedValue(true)
  mockWriteJsonFile.mockResolvedValue(undefined)
  mockReadJsonFile.mockResolvedValue({ jobs: {} })
})

// ── Tests ──────────────────────────────────────────────────────────────

describe('Pipeline Tools', () => {
  describe('Tool Registration', () => {
    it('registers process_video tool', () => {
      createTestServer()
      expect(registeredTools.has('process_video')).toBe(true)
    })

    it('has correct description', () => {
      createTestServer()
      const tool = registeredTools.get('process_video')
      expect(tool?.description).toContain('15 stages')
    })
  })

  describe('process_video', () => {
    it('returns a job handle immediately', async () => {
      createTestServer()
      mockProcessVideoSafe.mockResolvedValue({
        video: { slug: 'test-video' },
        stageResults: [],
        totalDuration: 100,
      })

      const result = await callTool('process_video', { videoPath: '/tmp/test.mp4' }) as {
        jobId: string
        status: string
        message: string
      }

      expect(result.jobId).toMatch(/^job-/)
      expect(result.status).toBe('running')
      expect(result.message).toContain('/tmp/test.mp4')
      expect(result.message).toContain(result.jobId)
    })

    it('persists job to disk before returning', async () => {
      createTestServer()
      mockProcessVideoSafe.mockImplementation(() => new Promise(() => {})) // never resolves

      await callTool('process_video', { videoPath: '/tmp/slow.mp4' })

      // Job should have been written to disk
      expect(mockWriteJsonFile).toHaveBeenCalled()
      const writeCall = mockWriteJsonFile.mock.calls[0]
      expect(writeCall[0]).toBe('/home/testuser/.vidpipe/mcp-jobs.json')
    })

    it('updates job to completed when pipeline finishes', async () => {
      createTestServer()
      let resolvePromise: (val: unknown) => void
      const pipelinePromise = new Promise(resolve => { resolvePromise = resolve })
      mockProcessVideoSafe.mockReturnValue(pipelinePromise)

      await callTool('process_video', { videoPath: '/tmp/test.mp4' })

      // Now resolve the pipeline
      resolvePromise!({
        video: { slug: 'test' },
        stageResults: [
          { stage: 'ingestion', success: true, duration: 5 },
          { stage: 'transcription', success: true, duration: 30 },
        ],
        totalDuration: 35,
      })

      // Wait a tick for the background promise to settle
      await new Promise(r => setTimeout(r, 50))

      // Should have written completed status
      const lastWrite = mockWriteJsonFile.mock.calls.at(-1)
      const data = lastWrite?.[1] as { jobs: Record<string, { status: string }> }
      const jobEntries = Object.values(data?.jobs ?? {})
      const completedJob = jobEntries.find(j => j.status === 'completed')
      expect(completedJob).toBeDefined()
    })

    it('updates job to failed when pipeline throws', async () => {
      createTestServer()
      let rejectPromise: (err: Error) => void
      const pipelinePromise = new Promise((_, reject) => { rejectPromise = reject })
      mockProcessVideoSafe.mockReturnValue(pipelinePromise)

      await callTool('process_video', { videoPath: '/tmp/bad.mp4' })

      // Reject the pipeline
      rejectPromise!(new Error('FFmpeg crashed'))

      // Wait for background promise
      await new Promise(r => setTimeout(r, 50))

      const lastWrite = mockWriteJsonFile.mock.calls.at(-1)
      const data = lastWrite?.[1] as { jobs: Record<string, { status: string; error?: string }> }
      const jobEntries = Object.values(data?.jobs ?? {})
      const failedJob = jobEntries.find(j => j.status === 'failed')
      expect(failedJob).toBeDefined()
      expect(failedJob?.error).toContain('FFmpeg crashed')
    })
  })
})
