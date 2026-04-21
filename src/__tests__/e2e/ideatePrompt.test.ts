/**
 * E2E — ideate prompt pass-through coverage.
 *
 * Mocks L6 ideation to avoid real LLM calls, then exercises the
 * prompt option through runIdeate's generate and --add paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Platform } from '../../L0-pure/types/index.js'

// ── Mocks ──────────────────────────────────────────────────────────────

const mockInitConfig = vi.hoisted(() => vi.fn())
vi.mock('../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
}))

const mockListIdeas = vi.hoisted(() => vi.fn())
const mockCreateIdea = vi.hoisted(() => vi.fn())
vi.mock('../../L3-services/ideaService/ideaService.js', () => ({
  listIdeas: mockListIdeas,
  createIdea: mockCreateIdea,
}))

const mockGenerateIdeas = vi.hoisted(() => vi.fn())
vi.mock('../../L6-pipeline/ideation.js', () => ({
  generateIdeas: mockGenerateIdeas,
}))

// ── Import module under test ───────────────────────────────────────────

import { runIdeate } from '../../L7-app/commands/ideate.js'

// ── Test data ──────────────────────────────────────────────────────────

const mockIdea = {
  issueNumber: 42,
  issueUrl: 'https://github.com/htekdev/content-management/issues/42',
  repoFullName: 'htekdev/content-management',
  id: 'idea-42',
  topic: 'AI agents for CI/CD',
  hook: 'AI is rewriting your pipeline',
  audience: 'devops engineers',
  keyTakeaway: 'CI/CD agents save hours per week',
  talkingPoints: ['Point 1', 'Point 2'],
  platforms: [Platform.YouTube, Platform.TikTok],
  status: 'draft' as const,
  tags: ['ai', 'devops'],
  createdAt: '2026-03-15T00:00:00Z',
  updatedAt: '2026-03-15T00:00:00Z',
  publishBy: '2026-03-29',
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('E2E: ideate prompt coverage', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

  function getOutput(): string {
    return consoleLogSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
  }

  it('logs prompt in generate mode (lines 85-87)', async () => {
    mockGenerateIdeas.mockResolvedValue([])

    await runIdeate({ prompt: 'Focus on MCP server patterns' })

    expect(getOutput()).toContain('Prompt: Focus on MCP server patterns')
  })

  it('passes prompt to generateIdeas in generate mode (line 99)', async () => {
    mockGenerateIdeas.mockResolvedValue([])

    await runIdeate({ prompt: 'Cover this article: https://example.com' })

    expect(mockGenerateIdeas).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Cover this article: https://example.com' }),
    )
  })

  it('passes prompt to generateIdeas in --add mode (line 194)', async () => {
    mockGenerateIdeas.mockResolvedValue([mockIdea])

    await runIdeate({ add: true, topic: 'AI agents', prompt: 'Focus on safety guardrails' })

    expect(mockGenerateIdeas).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Focus on safety guardrails',
        seedTopics: ['AI agents'],
        count: 1,
        singleTopic: true,
      }),
    )
  })

  it('omits prompt log when prompt is not provided', async () => {
    mockGenerateIdeas.mockResolvedValue([])

    await runIdeate({})

    expect(getOutput()).not.toContain('Prompt:')
  })
})
