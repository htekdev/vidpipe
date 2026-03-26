import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetIdeasByIds = vi.hoisted(() => vi.fn())
const mockGenerateAgenda = vi.hoisted(() => vi.fn())
const mockWriteTextFile = vi.hoisted(() => vi.fn())

vi.mock('../../../L3-services/ideation/ideaService.js', () => ({
  getIdeasByIds: mockGetIdeasByIds,
}))

vi.mock('../../../L6-pipeline/ideation.js', () => ({
  generateAgenda: mockGenerateAgenda,
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  writeTextFile: mockWriteTextFile,
}))

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import type { Idea, AgendaResult } from '../../../L0-pure/types/index.js'
import { runAgenda } from '../../../L7-app/commands/agenda.js'

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    issueNumber: 1,
    issueUrl: 'https://github.com/test/repo/issues/1',
    repoFullName: 'test/repo',
    id: 'idea-test',
    topic: 'Test Topic',
    hook: 'Hook text',
    audience: 'Developers',
    keyTakeaway: 'Takeaway',
    talkingPoints: ['Point 1'],
    platforms: [],
    status: 'draft',
    tags: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    publishBy: '2026-02-01',
    ...overrides,
  }
}

function makeAgendaResult(overrides: Partial<AgendaResult> = {}): AgendaResult {
  return {
    sections: [
      {
        order: 1,
        title: 'Section 1',
        ideaIssueNumber: 1,
        estimatedMinutes: 5,
        talkingPoints: ['Point'],
        transition: '',
        notes: '',
      },
    ],
    intro: 'Welcome',
    outro: 'Bye',
    estimatedDuration: 5,
    markdown: '# Agenda\nContent here',
    durationMs: 1000,
    ...overrides,
  }
}

describe('agenda command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit')
    }) as never)
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    processExitSpy.mockRestore()
  })

  test('agenda.REQ-001 exits with error when no issue numbers provided', async () => {
    const { runAgenda } = await import('../../../L7-app/commands/agenda.js')
    await expect(runAgenda([], {})).rejects.toThrow('process.exit')
    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  test('agenda.REQ-002 parses comma-separated issue numbers', async () => {
    const ideas = [makeIdea({ issueNumber: 1 }), makeIdea({ issueNumber: 2 })]
    mockGetIdeasByIds.mockResolvedValue(ideas)
    mockGenerateAgenda.mockResolvedValue(makeAgendaResult())
    mockWriteTextFile.mockResolvedValue(undefined)

    const { runAgenda } = await import('../../../L7-app/commands/agenda.js')
    await runAgenda(['1,2'], {})

    expect(mockGetIdeasByIds).toHaveBeenCalledWith(['1', '2'])
  })

  test('agenda.REQ-003 exits when no ideas found for provided IDs', async () => {
    mockGetIdeasByIds.mockResolvedValue([])

    const { runAgenda } = await import('../../../L7-app/commands/agenda.js')
    await expect(runAgenda(['999'], {})).rejects.toThrow('process.exit')

    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  test('agenda.REQ-004 calls generateAgenda and writes output file', async () => {
    const ideas = [makeIdea()]
    const result = makeAgendaResult()
    mockGetIdeasByIds.mockResolvedValue(ideas)
    mockGenerateAgenda.mockResolvedValue(result)
    mockWriteTextFile.mockResolvedValue(undefined)

    const { runAgenda } = await import('../../../L7-app/commands/agenda.js')
    await runAgenda(['1'], {})

    expect(mockGenerateAgenda).toHaveBeenCalledWith(ideas)
    expect(mockWriteTextFile).toHaveBeenCalledWith(
      expect.stringContaining('agenda-'),
      result.markdown,
    )
  })

  test('agenda.REQ-005 uses custom output path when provided', async () => {
    const ideas = [makeIdea()]
    mockGetIdeasByIds.mockResolvedValue(ideas)
    mockGenerateAgenda.mockResolvedValue(makeAgendaResult())
    mockWriteTextFile.mockResolvedValue(undefined)

    const { runAgenda } = await import('../../../L7-app/commands/agenda.js')
    await runAgenda(['1'], { output: 'custom-agenda.md' })

    expect(mockWriteTextFile).toHaveBeenCalledWith(
      expect.stringContaining('custom-agenda.md'),
      expect.any(String),
    )
  })

  test('agenda.REQ-006 exits when getIdeasByIds throws', async () => {
    mockGetIdeasByIds.mockRejectedValue(new Error('API error'))

    const { runAgenda } = await import('../../../L7-app/commands/agenda.js')
    await expect(runAgenda(['1'], {})).rejects.toThrow('process.exit')

    expect(processExitSpy).toHaveBeenCalledWith(1)
  })

  test('agenda.REQ-007 prints section summary to console', async () => {
    const ideas = [makeIdea()]
    const result = makeAgendaResult({
      sections: [
        { order: 1, title: 'Intro Section', ideaIssueNumber: 1, estimatedMinutes: 3, talkingPoints: [], transition: '', notes: '' },
        { order: 2, title: 'Main Section', ideaIssueNumber: 2, estimatedMinutes: 7, talkingPoints: [], transition: '', notes: '' },
      ],
      estimatedDuration: 10,
    })
    mockGetIdeasByIds.mockResolvedValue(ideas)
    mockGenerateAgenda.mockResolvedValue(result)
    mockWriteTextFile.mockResolvedValue(undefined)

    const { runAgenda } = await import('../../../L7-app/commands/agenda.js')
    await runAgenda(['1'], {})

    const output = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(output).toContain('10 min')
    expect(output).toContain('2 sections')
  })

  test('agenda.REQ-008 exits with error when only whitespace/empty IDs provided', async () => {
    const { runAgenda } = await import('../../../L7-app/commands/agenda.js')
    await expect(runAgenda(['  ,  , '], {})).rejects.toThrow('process.exit')

    expect(processExitSpy).toHaveBeenCalledWith(1)
  })
})
