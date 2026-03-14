import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Platform } from '../../../L0-pure/types/index.js'

const mockInitConfig = vi.hoisted(() => vi.fn())
const mockListIdeas = vi.hoisted(() => vi.fn())
const mockGenerateIdeas = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
}))

vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  listIdeas: mockListIdeas,
}))

vi.mock('../../../L6-pipeline/ideation.js', () => ({
  generateIdeas: mockGenerateIdeas,
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

  it('ideate.REQ-001 lists all saved ideas when no status filter is provided', async () => {
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

  it('ideate.REQ-002 filters listed ideas by status', async () => {
    mockListIdeas.mockResolvedValue([
      { id: 'idea-1', topic: 'First idea', status: 'draft', platforms: [Platform.YouTube] },
      { id: 'idea-2', topic: 'Second idea', status: 'ready', platforms: [Platform.LinkedIn] },
    ])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ list: true, status: 'ready' })

    expect(mockListIdeas).toHaveBeenCalledWith()
    expect(getOutput()).toContain('Second idea')
    expect(getOutput()).not.toContain('First idea')
  })

  it('ideate.REQ-010 parses topics and count before delegating to L6 ideation', async () => {
    mockGenerateIdeas.mockResolvedValue([
      { id: 'idea-1', topic: 'Ship ideate', hook: 'Use AI before you record.', audience: 'Builders', status: 'draft', platforms: ['youtube'] },
    ])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ topics: 'GitHub Copilot, Azure ', count: '2', output: 'custom-ideas' })

    expect(mockGenerateIdeas).toHaveBeenCalledWith({
      seedTopics: ['GitHub Copilot', 'Azure'],
      count: 2,
      ideasDir: 'custom-ideas',
      brandPath: undefined,
    })
    expect(getOutput()).toContain('Ship ideate')
  })

  it('ideate.REQ-020 passes brand path through to generateIdeas', async () => {
    mockGenerateIdeas.mockResolvedValue([])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ brand: './custom-brand.json' })

    expect(mockInitConfig).toHaveBeenCalled()
    expect(mockGenerateIdeas).toHaveBeenCalledWith(
      expect.objectContaining({ brandPath: './custom-brand.json' }),
    )
  })

  it('ideate.REQ-021 prints follow-up guidance after generating ideas', async () => {
    mockGenerateIdeas.mockResolvedValue([
      {
        id: 'idea-1',
        topic: 'Link recordings to ideas',
        hook: 'Keep ideation connected to the final video.',
        audience: 'Creators',
        status: 'draft',
        platforms: ['youtube', 'linkedin'],
      },
    ])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate()

    expect(getOutput()).toContain('Ideas saved to the GitHub-backed idea service.')
    expect(getOutput()).toContain('Use `vidpipe ideate --list` to view all ideas.')
    expect(getOutput()).toContain('Use `vidpipe process video.mp4 --ideas <issueNumber1>,<issueNumber2>` to link ideas to a recording.')
  })

  it('ideate.REQ-030 outputs JSON array when --list --format json is used', async () => {
    mockListIdeas.mockResolvedValue([
      { issueNumber: 1, id: 'idea-1', topic: 'First idea', hook: 'A great hook', audience: 'Devs', status: 'draft', platforms: [Platform.YouTube] },
      { issueNumber: 2, id: 'idea-2', topic: 'Second idea', hook: 'Another hook', audience: 'Creators', status: 'ready', platforms: [Platform.LinkedIn, Platform.X] },
    ])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ list: true, format: 'json' })

    const output = getOutput()
    const parsed = JSON.parse(output)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({
      issueNumber: 1,
      id: 'idea-1',
      topic: 'First idea',
      hook: 'A great hook',
      audience: 'Devs',
      platforms: [Platform.YouTube],
      status: 'draft',
    })
    expect(parsed[1]).toMatchObject({ id: 'idea-2', status: 'ready' })
  })

  it('ideate.REQ-031 JSON output respects --status filter', async () => {
    mockListIdeas.mockResolvedValue([
      { issueNumber: 1, id: 'idea-1', topic: 'Draft idea', hook: 'Hook', audience: 'Devs', status: 'draft', platforms: [Platform.YouTube] },
      { issueNumber: 2, id: 'idea-2', topic: 'Ready idea', hook: 'Hook', audience: 'Devs', status: 'ready', platforms: [Platform.LinkedIn] },
    ])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ list: true, format: 'json', status: 'ready' })

    const parsed = JSON.parse(getOutput())
    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('idea-2')
  })

  it('ideate.REQ-032 JSON output returns empty array when no ideas match', async () => {
    mockListIdeas.mockResolvedValue([])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ list: true, format: 'json' })

    const parsed = JSON.parse(getOutput())
    expect(parsed).toEqual([])
  })

  it('ideate.REQ-033 JSON output contains no decorative text', async () => {
    mockListIdeas.mockResolvedValue([
      { issueNumber: 1, id: 'idea-1', topic: 'Test', hook: 'H', audience: 'A', status: 'draft', platforms: [Platform.YouTube] },
    ])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ list: true, format: 'json' })

    const output = getOutput()
    expect(output).not.toContain('💡')
    expect(output).not.toContain('─')
    expect(output).not.toContain('idea(s) total')
    // Should be valid JSON
    expect(() => JSON.parse(output)).not.toThrow()
  })

  it('ideate.REQ-034 JSON output works for generate mode', async () => {
    mockGenerateIdeas.mockResolvedValue([
      { issueNumber: 5, id: 'new-idea', topic: 'Generated idea', hook: 'Fresh hook', audience: 'Builders', status: 'draft', platforms: ['youtube'] },
    ])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ format: 'json' })

    const output = getOutput()
    const parsed = JSON.parse(output)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ id: 'new-idea', topic: 'Generated idea' })
    expect(output).not.toContain('🧠')
    expect(output).not.toContain('Generated 1 idea(s)')
  })

  it('ideate.REQ-035 JSON generate mode outputs empty array when no ideas generated', async () => {
    mockGenerateIdeas.mockResolvedValue([])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ format: 'json' })

    const parsed = JSON.parse(getOutput())
    expect(parsed).toEqual([])
  })
})
