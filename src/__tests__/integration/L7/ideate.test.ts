import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Platform } from '../../../L0-pure/types/index.js'

const mockInitConfig = vi.hoisted(() => vi.fn())
const mockListIdeas = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
}))

vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  listIdeas: mockListIdeas,
}))

describe('ideate command', () => {
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

  it('lists all saved ideas', async () => {
    mockListIdeas.mockResolvedValue([
      { id: 'idea-1', topic: 'First idea', status: 'draft', platforms: [Platform.YouTube] },
      { id: 'idea-2', topic: 'Second idea', status: 'ready', platforms: [Platform.LinkedIn] },
    ])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ list: true })

    expect(mockListIdeas).toHaveBeenCalledWith()
    expect(getOutput()).toContain('First idea')
    expect(getOutput()).toContain('Second idea')
    expect(getOutput()).toContain('2 idea(s) total')
  })

  it('filters listed ideas by status', async () => {
    mockListIdeas.mockResolvedValue([
      { id: 'idea-1', topic: 'First idea', status: 'draft', platforms: [Platform.YouTube] },
      { id: 'idea-2', topic: 'Second idea', status: 'ready', platforms: [Platform.LinkedIn] },
    ])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ list: true, status: 'ready' })

    expect(getOutput()).toContain('Second idea')
    expect(getOutput()).not.toContain('First idea')
  })

  it('shows empty state with guidance', async () => {
    mockListIdeas.mockResolvedValue([])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ list: true })

    expect(getOutput()).toContain('No ideas found.')
    expect(getOutput()).toContain('Run `vidpipe ideate` to generate new ideas.')
  })

  it('prints follow-up guidance after generating ideas', async () => {
    const ideationModule = await import('../../../L6-pipeline/ideation.js')
    vi.spyOn(ideationModule, 'generateIdeas').mockResolvedValue([
      {
        id: 'idea-1',
        issueNumber: 42,
        issueUrl: 'https://github.com/htekdev/content-management/issues/42',
        repoFullName: 'htekdev/content-management',
        topic: 'Link recordings to ideas',
        hook: 'Keep ideation connected.',
        audience: 'Creators',
        keyTakeaway: 'Ship faster',
        talkingPoints: ['Point 1'],
        status: 'draft' as const,
        platforms: [Platform.YouTube, Platform.LinkedIn],
        tags: [],
        publishBy: '2026-04-01',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publishedContent: [],
      },
    ])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate()

    expect(getOutput()).toContain('Ideas saved to the GitHub-backed idea service.')
    expect(getOutput()).toContain('Use `vidpipe ideate --list` to view all ideas.')
    expect(getOutput()).toContain('Use `vidpipe process video.mp4 --ideas <issueNumber1>,<issueNumber2>` to link ideas to a recording.')
  })

  it('outputs valid JSON array when --list --format json is used', async () => {
    mockListIdeas.mockResolvedValue([
      {
        id: 'idea-1',
        issueNumber: 10,
        topic: 'First idea',
        hook: 'A great hook',
        audience: 'Developers',
        status: 'draft',
        platforms: [Platform.YouTube],
        tags: ['ai'],
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
      },
      {
        id: 'idea-2',
        issueNumber: 11,
        topic: 'Second idea',
        hook: 'Another hook',
        audience: 'Creators',
        status: 'ready',
        platforms: [Platform.LinkedIn, Platform.X],
        tags: [],
        createdAt: '2026-03-02T00:00:00Z',
        updatedAt: '2026-03-02T00:00:00Z',
      },
    ])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ list: true, format: 'json' })

    const output = getOutput()
    const parsed = JSON.parse(output)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({
      issueNumber: 10,
      id: 'idea-1',
      topic: 'First idea',
      hook: 'A great hook',
      audience: 'Developers',
      platforms: [Platform.YouTube],
      status: 'draft',
    })
    expect(output).not.toContain('💡')
    expect(output).not.toContain('idea(s) total')
  })

  it('JSON format with --status filter returns only matching ideas', async () => {
    mockListIdeas.mockResolvedValue([
      { id: 'draft-idea', issueNumber: 1, topic: 'Draft', hook: 'H', audience: 'A', status: 'draft', platforms: [Platform.YouTube] },
      { id: 'ready-idea', issueNumber: 2, topic: 'Ready', hook: 'H', audience: 'A', status: 'ready', platforms: [Platform.LinkedIn] },
    ])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ list: true, format: 'json', status: 'ready' })

    const parsed = JSON.parse(getOutput())
    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('ready-idea')
  })
})
