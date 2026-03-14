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
})
