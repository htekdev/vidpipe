import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Platform } from '../../../L0-pure/types/index.js'

const mockInitConfig = vi.hoisted(() => vi.fn())
const mockListIdeas = vi.hoisted(() => vi.fn())
const mockCreateIdea = vi.hoisted(() => vi.fn())
const mockGenerateIdeas = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
}))

vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  listIdeas: mockListIdeas,
  createIdea: mockCreateIdea,
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

  describe('--add mode', () => {
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

    it('ideate.REQ-040 --add flag triggers idea creation mode', async () => {
      mockGenerateIdeas.mockResolvedValue([mockIdea])

      const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
      await runIdeate({ add: true, topic: 'AI agents for CI/CD' })

      expect(mockGenerateIdeas).toHaveBeenCalledWith(
        expect.objectContaining({ count: 1, singleTopic: true, seedTopics: ['AI agents for CI/CD'] }),
      )
      expect(mockListIdeas).not.toHaveBeenCalled()
    })

    it('ideate.REQ-041 --topic is required when --add is used', async () => {
      const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
      await expect(runIdeate({ add: true })).rejects.toThrow('--topic is required when using --add')
    })

    it('ideate.REQ-042 prints issue number on success', async () => {
      mockGenerateIdeas.mockResolvedValue([mockIdea])

      const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
      await runIdeate({ add: true, topic: 'AI agents for CI/CD' })

      expect(getOutput()).toContain('Created idea #42: "AI agents for CI/CD"')
    })

    it('ideate.REQ-043 --format json prints full Idea object', async () => {
      mockGenerateIdeas.mockResolvedValue([mockIdea])

      const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
      await runIdeate({ add: true, topic: 'AI agents for CI/CD', format: 'json' })

      const parsed = JSON.parse(getOutput())
      expect(parsed.issueNumber).toBe(42)
      expect(parsed.topic).toBe('AI agents for CI/CD')
      expect(parsed.hook).toBe('AI is rewriting your pipeline')
    })

    it('ideate.REQ-044 defaults: hook=topic, audience=developers, platforms=youtube', async () => {
      mockCreateIdea.mockResolvedValue(mockIdea)

      const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
      await runIdeate({ add: true, topic: 'My Topic', ai: false })

      expect(mockCreateIdea).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'My Topic',
          hook: 'My Topic',
          audience: 'developers',
          platforms: [Platform.YouTube],
        }),
      )
    })

    it('ideate.REQ-045 defaults: keyTakeaway=hook, talkingPoints=[], tags=[], publishBy=14 days', async () => {
      mockCreateIdea.mockResolvedValue(mockIdea)

      const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
      await runIdeate({ add: true, topic: 'My Topic', ai: false })

      const call = mockCreateIdea.mock.calls[0][0]
      expect(call.keyTakeaway).toBe('My Topic')
      expect(call.talkingPoints).toEqual([])
      expect(call.tags).toEqual([])
      // publishBy should be ~14 days from now
      const publishDate = new Date(call.publishBy)
      const now = new Date()
      const diffDays = (publishDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      expect(diffDays).toBeGreaterThan(12)
      expect(diffDays).toBeLessThan(16)
    })

    it('ideate.REQ-046 rejects invalid platform names', async () => {
      const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
      await expect(
        runIdeate({ add: true, topic: 'Test', platforms: 'youtube,fakebook', ai: false }),
      ).rejects.toThrow('Invalid platform "fakebook"')
    })

    it('ideate.REQ-047 parses comma-separated platforms, talking points, and tags', async () => {
      mockCreateIdea.mockResolvedValue(mockIdea)

      const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
      await runIdeate({
        add: true,
        topic: 'Test',
        platforms: 'tiktok, youtube',
        talkingPoints: 'Point A, Point B, Point C',
        tags: 'ai, devtools',
        ai: false,
      })

      const call = mockCreateIdea.mock.calls[0][0]
      expect(call.platforms).toEqual([Platform.TikTok, Platform.YouTube])
      expect(call.talkingPoints).toEqual(['Point A', 'Point B', 'Point C'])
      expect(call.tags).toEqual(['ai', 'devtools'])
    })

    it('ideate.REQ-048 custom --publish-by date is forwarded', async () => {
      mockCreateIdea.mockResolvedValue(mockIdea)

      const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
      await runIdeate({ add: true, topic: 'Test', publishBy: '2026-06-01', ai: false })

      expect(mockCreateIdea).toHaveBeenCalledWith(
        expect.objectContaining({ publishBy: '2026-06-01' }),
      )
    })

    it('ideate.REQ-049 AI mode uses full IdeationAgent with research', async () => {
      mockGenerateIdeas.mockResolvedValue([mockIdea])

      const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
      await runIdeate({ add: true, topic: 'AI agents' })

      expect(mockGenerateIdeas).toHaveBeenCalledWith(
        expect.objectContaining({
          seedTopics: ['AI agents'],
          count: 1,
          singleTopic: true,
        }),
      )
      // Agent creates idea internally — no separate createIdea call
      expect(mockCreateIdea).not.toHaveBeenCalled()
    })

    it('ideate.REQ-049 throws when agent returns no ideas', async () => {
      mockGenerateIdeas.mockResolvedValue([])

      const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
      await expect(runIdeate({ add: true, topic: 'AI agents' })).rejects.toThrow('IdeationAgent did not create an idea')
    })

    it('ideate.REQ-049 --no-ai skips agent and uses direct creation with defaults', async () => {
      mockCreateIdea.mockResolvedValue(mockIdea)

      const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
      await runIdeate({ add: true, topic: 'Manual idea', ai: false })

      expect(mockGenerateIdeas).not.toHaveBeenCalled()
      expect(mockCreateIdea).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'Manual idea',
          hook: 'Manual idea',
          audience: 'developers',
          platforms: [Platform.YouTube],
        }),
      )
    })
  })
})
