import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Platform, type CreateIdeaInput, type Idea } from '../../../L0-pure/types/index.js'

const mockInitConfig = vi.hoisted(() => vi.fn())
const mockGetConfig = vi.hoisted(() => vi.fn())
const mockCreateIdea = vi.hoisted(() => vi.fn())
const mockLinkVideoToIdea = vi.hoisted(() => vi.fn())
const mockRecordPublish = vi.hoisted(() => vi.fn())
const mockSearchIdeas = vi.hoisted(() => vi.fn())
const mockUpdateIdea = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
  getConfig: mockGetConfig,
}))

vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  createIdea: mockCreateIdea,
  linkVideoToIdea: mockLinkVideoToIdea,
  recordPublish: mockRecordPublish,
  searchIdeas: mockSearchIdeas,
  updateIdea: mockUpdateIdea,
}))

function createIdeaRecord(overrides: Partial<Idea> = {}): Idea {
  return {
    issueNumber: overrides.issueNumber ?? 101,
    issueUrl: overrides.issueUrl ?? 'https://github.com/htekdev/content-management/issues/101',
    repoFullName: overrides.repoFullName ?? 'htekdev/content-management',
    id: overrides.id ?? 'idea-101',
    topic: overrides.topic ?? 'Agent HQ Strategy',
    hook: overrides.hook ?? 'Use multiple agents to catch tradeoffs sooner.',
    audience: overrides.audience ?? 'Developers evaluating AI workflows',
    keyTakeaway: overrides.keyTakeaway ?? 'Parallel agent reviews surface different risks.',
    talkingPoints: overrides.talkingPoints ?? ['Compare agent outputs', 'Review tradeoffs together'],
    platforms: overrides.platforms ?? [Platform.YouTube],
    status: overrides.status ?? 'draft',
    tags: overrides.tags ?? ['github-copilot'],
    createdAt: overrides.createdAt ?? '2026-03-13T18:23:19.883Z',
    updatedAt: overrides.updatedAt ?? '2026-03-13T18:23:19.883Z',
    publishBy: overrides.publishBy ?? '2026-03-27',
    sourceVideoSlug: overrides.sourceVideoSlug,
    trendContext: overrides.trendContext,
    publishedContent: overrides.publishedContent,
  }
}

async function writeIdeaFile(tempDir: string, fileName: string, contents: Record<string, unknown>): Promise<void> {
  await writeFile(join(tempDir, fileName), `${JSON.stringify(contents, null, 2)}\n`, 'utf8')
}

describe('runMigrateIdeasToGitHub', () => {
  let tempDir: string
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    tempDir = await mkdtemp(join(tmpdir(), 'vidpipe-migrate-ideas-'))
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    mockGetConfig.mockReturnValue({
      GITHUB_TOKEN: 'test-token',
      IDEAS_REPO: 'htekdev/content-management',
    })
    mockSearchIdeas.mockResolvedValue([])
    mockCreateIdea.mockResolvedValue(createIdeaRecord())
    mockLinkVideoToIdea.mockResolvedValue(undefined)
    mockRecordPublish.mockResolvedValue(undefined)
    mockUpdateIdea.mockResolvedValue(createIdeaRecord({ status: 'ready' }))
  })

  afterEach(async () => {
    consoleLogSpy.mockRestore()
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('migrates a new published idea, links the source video, and backfills legacy publish metadata', async () => {
    await writeIdeaFile(tempDir, 'agent-hq.json', {
      id: 'agent-hq-multi-agent-strategy',
      topic: 'Agent HQ Strategy: Using Copilot, Claude, and Codex Together for Better Code',
      hook: 'GitHub just became a multi-agent battleground — here\'s how to play it',
      audience: 'Teams and enterprise developers evaluating how to use multiple AI agents strategically',
      keyTakeaway: 'Running Copilot, Claude, and Codex on the same task surfaces different tradeoffs.',
      talkingPoints: ['Compare outputs', 'Discuss tradeoffs'],
      platforms: ['youtube', 'linkedin'],
      status: 'published',
      tags: ['GitHub Copilot', 'Agent HQ'],
      publishBy: '2026-03-27',
      sourceVideoSlug: 'bandicam-2026-03-13-13-52-34-460',
      publishedContent: [
        {
          clipType: 'video',
          platform: 'youtube',
          queueItemId: 'bandicam-2026-03-13-13-52-34-460-youtube',
          publishedAt: '2026-03-14T03:26:40.554Z',
        },
      ],
    })

    const { runMigrateIdeasToGitHub } = await import('../../../L7-app/commands/migrateIdeasToGithub.js')
    const summary = await runMigrateIdeasToGitHub({ ideasDir: tempDir, delayMs: 0 })

    expect(mockInitConfig).toHaveBeenCalled()
    expect(mockCreateIdea).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'Agent HQ Strategy: Using Copilot, Claude, and Codex Together for Better Code',
      platforms: [Platform.YouTube, Platform.LinkedIn],
      tags: ['GitHub Copilot', 'Agent HQ'],
      publishBy: '2026-03-27',
    } satisfies Partial<CreateIdeaInput>))
    expect(mockLinkVideoToIdea).toHaveBeenCalledWith(101, 'bandicam-2026-03-13-13-52-34-460')
    expect(mockRecordPublish).toHaveBeenCalledWith(101, expect.objectContaining({
      queueItemId: 'bandicam-2026-03-13-13-52-34-460-youtube',
      latePostId: 'legacy-import:agent-hq-multi-agent-strategy:bandicam-2026-03-13-13-52-34-460-youtube',
      lateUrl: 'legacy-import://bandicam-2026-03-13-13-52-34-460-youtube',
    }))
    expect(summary).toEqual({
      dryRun: false,
      ideaCount: 1,
      mappings: [{ oldId: 'agent-hq-multi-agent-strategy', newIssueNumber: 101 }],
      failures: [],
    })
    expect(mockUpdateIdea).not.toHaveBeenCalled()
  })

  it('reuses an existing issue with the same title and only promotes status when needed', async () => {
    await writeIdeaFile(tempDir, 'existing.json', {
      id: 'copilot-agent-mcp-integration',
      topic: 'Supercharge Copilot Coding Agent with MCP Servers',
      hook: 'Copilot agent can now reach OUTSIDE GitHub using MCP.',
      audience: 'Developers building AI-assisted workflows and automation',
      keyTakeaway: 'MCP servers give Copilot coding agent access to external data and capabilities.',
      talkingPoints: ['Explain MCP', 'Show GitHub MCP server'],
      platforms: ['youtube', 'linkedin'],
      status: 'ready',
      tags: ['github-copilot', 'mcp'],
      publishBy: '2026-03-27',
    })

    mockSearchIdeas.mockResolvedValue([
      createIdeaRecord({
        issueNumber: 55,
        topic: 'Supercharge Copilot Coding Agent with MCP Servers',
        status: 'draft',
        platforms: [Platform.YouTube, Platform.LinkedIn],
        tags: ['github-copilot', 'mcp'],
      }),
    ])
    mockUpdateIdea.mockResolvedValue(
      createIdeaRecord({
        issueNumber: 55,
        topic: 'Supercharge Copilot Coding Agent with MCP Servers',
        status: 'ready',
        platforms: [Platform.YouTube, Platform.LinkedIn],
        tags: ['github-copilot', 'mcp'],
      }),
    )

    const { runMigrateIdeasToGitHub } = await import('../../../L7-app/commands/migrateIdeasToGithub.js')
    const summary = await runMigrateIdeasToGitHub({ ideasDir: tempDir, delayMs: 0 })

    expect(mockCreateIdea).not.toHaveBeenCalled()
    expect(mockUpdateIdea).toHaveBeenCalledWith(55, { status: 'ready' })
    expect(mockLinkVideoToIdea).not.toHaveBeenCalled()
    expect(mockRecordPublish).not.toHaveBeenCalled()
    expect(summary.mappings).toEqual([{ oldId: 'copilot-agent-mcp-integration', newIssueNumber: 55 }])
  })

  it('restores a higher existing status after backfilling a missing source video link', async () => {
    await writeIdeaFile(tempDir, 'published-existing.json', {
      id: 'agent-hq-multi-agent-strategy',
      topic: 'Agent HQ Strategy: Using Copilot, Claude, and Codex Together for Better Code',
      hook: 'GitHub just became a multi-agent battleground — here\'s how to play it',
      audience: 'Teams and enterprise developers evaluating how to use multiple AI agents strategically',
      keyTakeaway: 'Running Copilot, Claude, and Codex on the same task surfaces different tradeoffs.',
      talkingPoints: ['Compare outputs', 'Discuss tradeoffs'],
      platforms: ['youtube', 'linkedin'],
      status: 'recorded',
      tags: ['GitHub Copilot', 'Agent HQ'],
      publishBy: '2026-03-27',
      sourceVideoSlug: 'bandicam-2026-03-13-13-52-34-460',
    })

    mockSearchIdeas.mockResolvedValue([
      createIdeaRecord({
        issueNumber: 88,
        topic: 'Agent HQ Strategy: Using Copilot, Claude, and Codex Together for Better Code',
        status: 'published',
      }),
    ])
    mockUpdateIdea.mockResolvedValue(
      createIdeaRecord({
        issueNumber: 88,
        topic: 'Agent HQ Strategy: Using Copilot, Claude, and Codex Together for Better Code',
        status: 'published',
        sourceVideoSlug: 'bandicam-2026-03-13-13-52-34-460',
      }),
    )

    const { runMigrateIdeasToGitHub } = await import('../../../L7-app/commands/migrateIdeasToGithub.js')
    await runMigrateIdeasToGitHub({ ideasDir: tempDir, delayMs: 0 })

    expect(mockLinkVideoToIdea).toHaveBeenCalledWith(88, 'bandicam-2026-03-13-13-52-34-460')
    expect(mockUpdateIdea).toHaveBeenCalledWith(88, { status: 'published' })
  })

  it('supports dry-run mode without creating or mutating issues', async () => {
    await writeIdeaFile(tempDir, 'dry-run.json', {
      id: 'agents-md-governance-file',
      topic: 'AGENTS.md: The New File Every Repo Needs for AI Agent Governance',
      hook: 'There\'s a new file that controls how AI agents work in your repo.',
      audience: 'Developers and team leads adopting AI coding tools',
      keyTakeaway: 'AGENTS.md brings governance to agentic development.',
      talkingPoints: ['Explain AGENTS.md', 'Compare with copilot-instructions.md'],
      platforms: ['youtube', 'tiktok'],
      status: 'draft',
      tags: ['github-copilot', 'governance'],
      publishBy: '2026-03-27',
    })

    const { runMigrateIdeasToGitHub } = await import('../../../L7-app/commands/migrateIdeasToGithub.js')
    const summary = await runMigrateIdeasToGitHub({ ideasDir: tempDir, dryRun: true, delayMs: 0 })

    expect(mockCreateIdea).not.toHaveBeenCalled()
    expect(mockLinkVideoToIdea).not.toHaveBeenCalled()
    expect(mockRecordPublish).not.toHaveBeenCalled()
    expect(mockUpdateIdea).not.toHaveBeenCalled()
    expect(summary).toEqual({
      dryRun: true,
      ideaCount: 1,
      mappings: [],
      failures: [],
    })
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[DRY RUN] agents-md-governance-file'))
  })
})
