import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Platform, type Idea, type SocialPost } from '../../../L0-pure/types/index.js'
import { initConfig } from '../../../L1-infra/config/environment.js'

const mockState = vi.hoisted(() => ({
  tools: [] as Array<{
    name: string
    handler: (args: Record<string, unknown>) => Promise<unknown>
  }>,
}))

const mockCreateIssue = vi.hoisted(() => vi.fn())
const mockListIssues = vi.hoisted(() => vi.fn())
const mockListComments = vi.hoisted(() => vi.fn())
const mockFfprobe = vi.hoisted(() => vi.fn())
const MockGitHubClientError = vi.hoisted(() => class MockGitHubClientError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GitHubClientError'
    this.status = status
  }
})

vi.mock('../../../L2-clients/github/githubClient.js', () => ({
  GitHubClientError: MockGitHubClientError,
  getGitHubClient: () => ({
    createIssue: mockCreateIssue,
    listIssues: mockListIssues,
    listComments: mockListComments,
  }),
}))

vi.mock('../../../L2-clients/llm/index.js', () => ({
  getProvider: vi.fn(() => ({
    name: 'copilot',
    isAvailable: () => true,
    getDefaultModel: () => 'mock-model',
    createSession: async (config: {
      tools: Array<{
        name: string
        handler: (args: Record<string, unknown>) => Promise<unknown>
      }>
    }) => {
      mockState.tools = config.tools
      return {
        on: () => {},
        close: async () => {},
        sendAndWait: async () => ({
          content: 'captured',
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          durationMs: 1,
        }),
      }
    },
  })),
  resetProvider: vi.fn(async () => {}),
  getProviderName: vi.fn(() => 'copilot'),
}))

vi.mock('../../../L2-clients/ffmpeg/ffmpeg.js', () => ({
  getFFmpegPath: vi.fn(() => 'ffmpeg'),
  getFFprobePath: vi.fn(() => 'ffprobe'),
  ffprobe: mockFfprobe,
}))

import { generateIdeas } from '../../../L4-agents/IdeationAgent.js'
import { MainVideoAsset } from '../../../L5-assets/MainVideoAsset.js'
import { getItem } from '../../../L3-services/postStore/postStore.js'

interface MockGitHubIssue {
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  labels: string[]
  created_at: string
  updated_at: string
  html_url: string
}

interface MockGitHubComment {
  id: number
  body: string
  created_at: string
  updated_at: string
  html_url: string
}

let sandboxDir: string
let brandPath: string
let outputDir: string

async function writeBrandFixture(targetPath: string): Promise<void> {
  await writeFile(
    targetPath,
    JSON.stringify({
      name: 'Integration Tester',
      handle: '@integrationtester',
      tagline: 'Practical AI video ops',
      voice: {
        tone: 'clear',
        personality: 'helpful',
        style: 'direct',
      },
      advocacy: {
        primary: ['GitHub Copilot'],
        interests: ['AI video production'],
        avoids: ['filler'],
      },
      customVocabulary: ['Copilot', 'FFmpeg'],
      hashtags: { always: [], preferred: [], platforms: {} },
      contentGuidelines: {
        shortsFocus: 'Fast practical wins',
        blogFocus: 'Detailed walkthroughs',
        socialFocus: 'Useful insights for builders',
      },
      contentPillars: [
        {
          pillar: 'Agentic Video Workflows',
          description: 'How AI agents help creators ship faster',
          frequency: 'weekly',
          formats: ['video', 'social'],
        },
      ],
    }),
    'utf8',
  )
}

function makeIssue(overrides: Partial<MockGitHubIssue> & Pick<MockGitHubIssue, 'number' | 'title' | 'body'>): MockGitHubIssue {
  const number = overrides.number
  return {
    number,
    title: overrides.title,
    body: overrides.body,
    state: overrides.state ?? 'open',
    labels: overrides.labels ?? [],
    created_at: overrides.created_at ?? '2026-03-10T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-03-11T00:00:00.000Z',
    html_url: overrides.html_url ?? `https://github.com/htekdev/content-management/issues/${number}`,
  }
}

function makeIdeaBody(overrides: Partial<{
  hook: string
  audience: string
  keyTakeaway: string
  talkingPoints: string[]
  publishBy: string
  trendContext: string
}> = {}): string {
  const talkingPoints = overrides.talkingPoints ?? ['Point one', 'Point two']
  const trendContext = overrides.trendContext ?? 'Grounded in current creator workflow demand.'

  return [
    '## Hook',
    overrides.hook ?? 'Hook text',
    '',
    '## Audience',
    overrides.audience ?? 'Developers',
    '',
    '## Key Takeaway',
    overrides.keyTakeaway ?? 'One clear takeaway',
    '',
    '## Talking Points',
    ...talkingPoints.map((point) => `- ${point}`),
    '',
    '## Publish By',
    overrides.publishBy ?? '2026-03-20',
    '',
    '## Trend Context',
    trendContext,
  ].join('\n')
}

function makeIdea(issueNumber: number, id: string): Idea {
  return {
    issueNumber,
    issueUrl: `https://github.com/htekdev/content-management/issues/${issueNumber}`,
    repoFullName: 'htekdev/content-management',
    id,
    topic: `Idea ${issueNumber}`,
    hook: `Hook ${issueNumber}`,
    audience: 'Developers',
    keyTakeaway: 'Use issue numbers as queue identifiers.',
    talkingPoints: ['One', 'Two'],
    platforms: [Platform.YouTube],
    status: 'recorded',
    tags: ['integration'],
    createdAt: '2026-03-10T00:00:00.000Z',
    updatedAt: '2026-03-11T00:00:00.000Z',
    publishBy: '2026-03-20',
  }
}

function getCapturedTool(name: string): (args: Record<string, unknown>) => Promise<unknown> {
  const tool = mockState.tools.find((entry) => entry.name === name)
  if (!tool) {
    throw new Error(`Expected tool ${name} to be captured`)
  }

  return tool.handler
}

async function captureIdeationTools(): Promise<void> {
  mockState.tools = []
  mockListIssues.mockResolvedValue([])
  mockListComments.mockResolvedValue([])

  await generateIdeas({
    count: 3,
    seedTopics: ['GitHub Copilot'],
    brandPath,
  })
}

describe('L4-L6 Integration: ideation and queue builder', () => {
  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(tmpdir(), 'vidpipe-ideation-int-'))
    brandPath = join(sandboxDir, 'brand.json')
    outputDir = join(sandboxDir, 'recordings')

    await writeBrandFixture(brandPath)
    initConfig({
      outputDir,
      brand: brandPath,
      ideasRepo: 'htekdev/content-management',
      githubToken: 'test-token',
    })

    mockState.tools = []
    mockCreateIssue.mockReset()
    mockListIssues.mockReset()
    mockListComments.mockReset()
    mockFfprobe.mockReset()
    mockFfprobe.mockResolvedValue({
      format: { duration: 120, size: 4096 },
      streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
    })
  })

  afterEach(async () => {
    await rm(sandboxDir, { recursive: true, force: true })
  })

  test('IdeationAgent create_idea tool handler uses L3 createIdea and mocked L2 createIssue', async () => {
    await captureIdeationTools()
    vi.clearAllMocks()

    const createIdea = getCapturedTool('create_idea')
    mockCreateIssue.mockImplementation(async (input: { title: string; body: string; labels?: readonly string[] }) => makeIssue({
      number: 101,
      title: input.title,
      body: input.body,
      labels: [...(input.labels ?? [])],
    }))

    const result = await createIdea({
      topic: 'GitHub Copilot CLI Release Recap',
      hook: 'The 3 Copilot CLI updates that matter this week',
      audience: 'Developers evaluating Copilot CLI changes',
      keyTakeaway: 'Weekly release notes become actionable when framed around real workflows.',
      talkingPoints: ['Newest CLI capabilities', 'Who benefits first'],
      platforms: [Platform.YouTube, Platform.LinkedIn],
      tags: ['copilot', 'release-notes'],
      publishBy: '2026-03-18',
      trendContext: 'Weekly releases create a timely news peg for creators.',
    }) as { success: true; idea: Idea }

    expect(mockCreateIssue).toHaveBeenCalledTimes(1)
    expect(mockCreateIssue).toHaveBeenCalledWith(expect.objectContaining({
      title: 'GitHub Copilot CLI Release Recap',
      body: expect.stringContaining('## Hook'),
      labels: expect.arrayContaining(['status:draft', 'platform:youtube', 'platform:linkedin', 'copilot', 'release-notes']),
    }))
    expect(result.success).toBe(true)
    expect(result.idea).toMatchObject({
      issueNumber: 101,
      id: 'idea-101',
      topic: 'GitHub Copilot CLI Release Recap',
      status: 'draft',
      platforms: [Platform.YouTube, Platform.LinkedIn],
      publishBy: '2026-03-18',
    })
  })

  test('IdeationAgent get_past_ideas tool handler uses L3 listIdeas and mocked L2 listIssues', async () => {
    await captureIdeationTools()
    vi.clearAllMocks()

    const getPastIdeas = getCapturedTool('get_past_ideas')
    const listedIssue = makeIssue({
      number: 77,
      title: 'AI video workflow idea',
      body: makeIdeaBody({
        hook: 'Use one workflow to turn long videos into shippable clips',
        publishBy: '2026-03-22',
      }),
      labels: ['status:ready', 'platform:youtube', 'ai-video', 'priority:timely'],
    })
    const comments: MockGitHubComment[] = []

    mockListIssues.mockResolvedValue([listedIssue])
    mockListComments.mockResolvedValue(comments)

    const result = await getPastIdeas({
      status: 'ready',
      platform: Platform.YouTube,
      limit: 1,
    }) as Idea[]

    expect(mockListIssues).toHaveBeenCalledTimes(1)
    expect(mockListIssues).toHaveBeenCalledWith({
      labels: ['status:ready', 'platform:youtube'],
      maxResults: 1,
    })
    expect(mockListComments).toHaveBeenCalledWith(77)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      issueNumber: 77,
      id: 'idea-77',
      repoFullName: 'htekdev/content-management',
      topic: 'AI video workflow idea',
      status: 'ready',
      platforms: [Platform.YouTube],
      tags: ['ai-video'],
      publishBy: '2026-03-22',
    })
  })

  test('MainVideoAsset.buildQueue stores issueNumber-based ideaIds in the publish queue', async () => {
    const videoDir = join(outputDir, 'video-with-ideas')
    await mkdir(videoDir, { recursive: true })
    await writeFile(join(videoDir, 'video-with-ideas.mp4'), Buffer.alloc(32))

    const postPath = join(videoDir, 'youtube-post.md')
    await writeFile(postPath, 'A polished YouTube description', 'utf8')

    const asset = await MainVideoAsset.load(videoDir)
    asset.setIdeas([
      makeIdea(42, 'legacy-idea-id'),
      makeIdea(108, 'idea-never-use-this-slug'),
    ])

    const socialPosts: SocialPost[] = [{
      platform: Platform.YouTube,
      content: 'A polished YouTube description',
      hashtags: ['copilot'],
      links: [],
      characterCount: 30,
      outputPath: postPath,
    }]

    await asset.buildQueue([], [], socialPosts, undefined)

    const queueItem = await getItem('video-with-ideas-youtube')
    expect(queueItem).not.toBeNull()
    expect(queueItem?.metadata.ideaIds).toEqual(['42', '108'])
    expect(queueItem?.metadata.ideaIds).not.toContain('legacy-idea-id')
    expect(queueItem?.metadata.ideaIds).not.toContain('idea-never-use-this-slug')
  })
})
