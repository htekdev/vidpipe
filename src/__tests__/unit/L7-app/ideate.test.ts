import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Platform } from '../../../L0-pure/types/index.js'

const mockInitConfig = vi.hoisted(() => vi.fn())
const mockReadIdeaBank = vi.hoisted(() => vi.fn())
const mockGenerateIdeas = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
}))

vi.mock('../../../L1-infra/ideaStore/ideaStore.js', () => ({
  readIdeaBank: mockReadIdeaBank,
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

  it('ideate.REQ-001 lists saved ideas from the idea bank', async () => {
    mockReadIdeaBank.mockResolvedValue([
      { id: 'idea-1', topic: 'First idea', status: 'draft', platforms: [Platform.YouTube] },
      { id: 'idea-2', topic: 'Second idea', status: 'ready', platforms: [Platform.LinkedIn] },
    ])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ list: true, status: 'ready' })

    expect(mockReadIdeaBank).toHaveBeenCalledWith(undefined)
    const output = consoleLogSpy.mock.calls.map((call: unknown[]) => call[0]).join('\n')
    expect(output).toContain('Second idea')
    expect(output).not.toContain('First idea')
  })

  it('ideate.REQ-010 parses topics and count before delegating to L6 ideation', async () => {
    mockGenerateIdeas.mockResolvedValue([
      { id: 'idea-1', topic: 'Ship ideate', hook: 'Use AI before you record.', status: 'draft', platforms: ['youtube'] },
    ])

    const { runIdeate } = await import('../../../L7-app/commands/ideate.js')
    await runIdeate({ topics: 'GitHub Copilot, Azure ', count: '2', output: 'custom-ideas' })

    expect(mockGenerateIdeas).toHaveBeenCalledWith({
      seedTopics: ['GitHub Copilot', 'Azure'],
      count: 2,
      ideasDir: 'custom-ideas',
    })
    const output = consoleLogSpy.mock.calls.map((call: unknown[]) => call[0]).join('\n')
    expect(output).toContain('Ship ideate')
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
})
