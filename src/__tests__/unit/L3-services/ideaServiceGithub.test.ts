import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Platform, type CreateIdeaInput, type IdeaPublishRecord } from '../../../L0-pure/types/index.js'
import logger from '../../../L1-infra/logger/configLogger.js'

const mockGitHubClient = vi.hoisted(() => ({
  createIssue: vi.fn(),
  updateIssue: vi.fn(),
  getIssue: vi.fn(),
  listIssues: vi.fn(),
  searchIssues: vi.fn(),
  addComment: vi.fn(),
  listComments: vi.fn(),
}))

const MockGitHubClientError = vi.hoisted(() => class extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GitHubClientError'
    this.status = status
  }
})

vi.mock('../../../L2-clients/github/githubClient.js', () => ({
  getGitHubClient: vi.fn(() => mockGitHubClient),
  GitHubClientError: MockGitHubClientError,
}))

import {
  createIdea,
  findRelatedIdeas,
  getIdea,
  getPublishHistory,
  getReadyIdeas,
  linkVideoToIdea,
  listIdeas,
  markPublished,
  markRecorded,
  recordPublish,
  searchIdeas,
  updateIdea,
} from '../../../L3-services/ideaService/ideaService.js'

function createIdeaBody(overrides: Partial<CreateIdeaInput> = {}): string {
  const input: CreateIdeaInput = {
    topic: overrides.topic ?? 'Build reliable agent loops',
    hook: overrides.hook ?? 'Your agent is failing for one hidden reason',
    audience: overrides.audience ?? 'Developers shipping AI-assisted tools',
    keyTakeaway: overrides.keyTakeaway ?? 'Reliable automation needs clear diagnostics and retries.',
    talkingPoints: overrides.talkingPoints ?? ['Show the failure mode', 'Explain the fix'],
    platforms: overrides.platforms ?? [Platform.YouTube, Platform.LinkedIn],
    tags: overrides.tags ?? ['copilot', 'agents'],
    publishBy: overrides.publishBy ?? '2026-03-01',
    trendContext: overrides.trendContext ?? 'AI agent reliability is a hot topic this month.',
  }

  return [
    '## Hook',
    input.hook,
    '',
    '## Audience',
    input.audience,
    '',
    '## Key Takeaway',
    input.keyTakeaway,
    '',
    '## Talking Points',
    ...input.talkingPoints.map((point) => `- ${point}`),
    '',
    '## Publish By',
    input.publishBy,
    '',
    '## Trend Context',
    input.trendContext ?? '',
  ].join('\n')
}

function createIssue(overrides: Partial<{
  number: number
  html_url: string
  title: string
  body: string
  labels: string[]
  created_at: string
  updated_at: string
}> = {}) {
  return {
    number: overrides.number ?? 42,
    html_url: overrides.html_url ?? 'https://github.com/htekdev/content-management/issues/42',
    title: overrides.title ?? 'Build reliable agent loops',
    body: overrides.body ?? createIdeaBody(),
    labels: overrides.labels ?? ['status:ready', 'platform:youtube', 'platform:linkedin', 'priority:timely', 'copilot', 'agents'],
    created_at: overrides.created_at ?? '2026-02-15T12:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-02-16T12:00:00.000Z',
  }
}

function createComment(overrides: Partial<{
  id: number
  body: string
  html_url: string
  created_at: string
  updated_at: string
}> = {}) {
  return {
    id: overrides.id ?? 1,
    body: overrides.body ?? '',
    html_url: overrides.html_url ?? 'https://github.com/htekdev/content-management/issues/42#issuecomment-1',
    created_at: overrides.created_at ?? '2026-02-16T12:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-02-16T12:00:00.000Z',
  }
}

function createPublishRecord(overrides: Partial<IdeaPublishRecord> = {}): IdeaPublishRecord {
  return {
    clipType: overrides.clipType ?? 'short',
    platform: overrides.platform ?? Platform.YouTube,
    queueItemId: overrides.queueItemId ?? 'queue-123',
    publishedAt: overrides.publishedAt ?? '2026-02-20T12:00:00.000Z',
    latePostId: overrides.latePostId ?? 'late-123',
    lateUrl: overrides.lateUrl ?? 'https://late.example/posts/late-123',
  }
}

function createVideoLinkComment(videoSlug = 'video-debug-loop'): string {
  return [
    'Linked a source video to this idea.',
    '',
    `- Video slug: ${videoSlug}`,
    '- Linked at: 2026-02-17T12:00:00.000Z',
    '',
    '<!-- vidpipe:idea-comment -->',
    '```json',
    JSON.stringify({ type: 'video-link', videoSlug, linkedAt: '2026-02-17T12:00:00.000Z' }, null, 2),
    '```',
  ].join('\n')
}

function createPublishComment(record: IdeaPublishRecord): string {
  return [
    'Published content recorded for this idea.',
    '',
    `- Clip type: ${record.clipType}`,
    `- Platform: ${record.platform}`,
    `- Queue item: ${record.queueItemId}`,
    `- Published at: ${record.publishedAt}`,
    `- Late post ID: ${record.latePostId}`,
    `- Late URL: ${record.lateUrl}`,
    '',
    '<!-- vidpipe:idea-comment -->',
    '```json',
    JSON.stringify({ type: 'publish-record', record }, null, 2),
    '```',
  ].join('\n')
}

describe('ideaService GitHub integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGitHubClient.createIssue.mockResolvedValue(createIssue({ labels: ['status:draft', 'platform:youtube', 'copilot'] }))
    mockGitHubClient.updateIssue.mockResolvedValue(createIssue())
    mockGitHubClient.getIssue.mockResolvedValue(createIssue())
    mockGitHubClient.listIssues.mockResolvedValue([])
    mockGitHubClient.searchIssues.mockResolvedValue([])
    mockGitHubClient.addComment.mockResolvedValue(createComment())
    mockGitHubClient.listComments.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ideaService.REQ-001 ideaService.REQ-012 ideaService.REQ-013 - createIdea formats the body, applies GitHub labels, and maps the created issue', async () => {
    const input: CreateIdeaInput = {
      topic: 'Build reliable agent loops',
      hook: 'Your agent is failing for one hidden reason',
      audience: 'Developers shipping AI-assisted tools',
      keyTakeaway: 'Reliable automation needs clear diagnostics and retries.',
      talkingPoints: ['Show the failure mode', 'Explain the fix'],
      platforms: [Platform.YouTube, Platform.LinkedIn],
      tags: ['copilot', 'agents'],
      publishBy: '2026-03-01',
      trendContext: 'AI agent reliability is a hot topic this month.',
    }

    const result = await createIdea(input)

    expect(mockGitHubClient.createIssue).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Build reliable agent loops',
      body: expect.stringContaining('## Hook'),
      labels: expect.arrayContaining(['status:draft', 'platform:youtube', 'platform:linkedin', 'copilot', 'agents']),
    }))
    expect(result).toMatchObject({
      issueNumber: 42,
      topic: 'Build reliable agent loops',
      status: 'draft',
      platforms: [Platform.YouTube],
    })
  })

  it('ideaService.REQ-013 - createIdea uses the 14-day threshold for priority:timely labels', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'))

    await createIdea({
      topic: 'Evergreen release notes',
      hook: 'Ship once, explain twice',
      audience: 'Developers documenting launches',
      keyTakeaway: 'Ideas beyond two weeks should not be labeled timely.',
      talkingPoints: ['Capture the change', 'Explain the why'],
      platforms: [Platform.YouTube],
      tags: ['docs'],
      publishBy: '2026-03-05',
      trendContext: 'Release communication keeps teams aligned.',
    })

    expect(mockGitHubClient.createIssue).toHaveBeenCalledWith(expect.objectContaining({
      labels: expect.arrayContaining(['priority:evergreen']),
    }))
    expect(mockGitHubClient.createIssue).toHaveBeenCalledWith(expect.not.objectContaining({
      labels: expect.arrayContaining(['priority:timely']),
    }))
  })

  it('ideaService.REQ-003 ideaService.REQ-014 ideaService.REQ-015 - getIdea reconstructs the full idea from issue body, labels, and structured comments', async () => {
    const publishRecord = createPublishRecord()
    mockGitHubClient.getIssue.mockResolvedValue(createIssue())
    mockGitHubClient.listComments.mockResolvedValue([
      createComment({ id: 1, body: createVideoLinkComment('video-debug-loop') }),
      createComment({ id: 2, body: createPublishComment(publishRecord) }),
    ])

    const idea = await getIdea(42)

    expect(idea).toMatchObject({
      issueNumber: 42,
      topic: 'Build reliable agent loops',
      sourceVideoSlug: 'video-debug-loop',
      publishedContent: [publishRecord],
      tags: ['copilot', 'agents'],
    })
  })

  it('ideaService.REQ-002 - updateIdea merges edited fields and recalculates labels from the updated status and metadata', async () => {
    mockGitHubClient.getIssue.mockResolvedValue(createIssue())
    mockGitHubClient.listComments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    mockGitHubClient.updateIssue.mockResolvedValue(createIssue({
      title: 'Updated idea title',
      body: createIdeaBody({ keyTakeaway: 'Updated takeaway', publishBy: '2026-02-18' }),
      labels: ['status:published', 'platform:youtube', 'copilot'],
    }))

    const updated = await updateIdea(42, {
      topic: 'Updated idea title',
      keyTakeaway: 'Updated takeaway',
      publishBy: '2026-02-18',
      status: 'published',
      platforms: [Platform.YouTube],
      tags: ['copilot'],
    })

    expect(mockGitHubClient.updateIssue).toHaveBeenCalledWith(42, expect.objectContaining({
      title: 'Updated idea title',
      body: expect.stringContaining('Updated takeaway'),
      labels: expect.arrayContaining(['status:published', 'platform:youtube', 'copilot']),
    }))
    expect(updated).toMatchObject({
      topic: 'Updated idea title',
      status: 'published',
      platforms: [Platform.YouTube],
      keyTakeaway: 'Updated takeaway',
    })
  })

  it('ideaService.REQ-008 - recordPublish skips duplicate queue items and still ensures the idea is labeled published', async () => {
    const publishRecord = createPublishRecord({ queueItemId: 'queue-duplicate' })
    mockGitHubClient.getIssue.mockResolvedValue(createIssue({ labels: ['status:recorded', 'platform:youtube', 'copilot'] }))
    mockGitHubClient.listComments.mockResolvedValue([
      createComment({ body: createPublishComment(publishRecord) }),
    ])

    await recordPublish(42, publishRecord)

    expect(mockGitHubClient.addComment).not.toHaveBeenCalled()
    expect(mockGitHubClient.updateIssue).toHaveBeenCalledWith(42, expect.objectContaining({
      labels: expect.arrayContaining(['status:published', 'platform:youtube', 'copilot']),
    }))
  })

  it('ideaService.REQ-007 ideaService.REQ-014 - linkVideoToIdea adds a structured video-link comment and updates the lifecycle to recorded', async () => {
    mockGitHubClient.getIssue.mockResolvedValue(createIssue({ labels: ['status:ready', 'platform:youtube', 'copilot'] }))

    await linkVideoToIdea(42, 'video-linked')

    expect(mockGitHubClient.addComment).toHaveBeenCalledWith(42, expect.stringContaining('video-linked'))
    expect(mockGitHubClient.updateIssue).toHaveBeenCalledWith(42, expect.objectContaining({
      labels: expect.arrayContaining(['status:recorded', 'platform:youtube', 'copilot']),
    }))
  })

  it('ideaService.REQ-005 ideaService.REQ-006 ideaService.REQ-010 - getReadyIdeas, searchIdeas, findRelatedIdeas, and getPublishHistory use the GitHub issue source of truth', async () => {
    const firstIssue = createIssue({ number: 7, title: 'Ready idea', labels: ['status:ready', 'platform:youtube', 'copilot'] })
    const secondIssue = createIssue({ number: 8, title: 'Related idea', labels: ['status:ready', 'platform:youtube', 'copilot', 'agents'] })
    const publishRecord = createPublishRecord({ queueItemId: 'queue-history' })

    mockGitHubClient.listIssues
      .mockResolvedValueOnce([firstIssue])
      .mockResolvedValueOnce([firstIssue, secondIssue])
      .mockResolvedValueOnce([secondIssue])
    mockGitHubClient.searchIssues.mockResolvedValue([firstIssue])
    mockGitHubClient.listComments.mockImplementation(async (issueNumber: number) => {
      if (issueNumber === 7) {
        return [createComment({ body: createPublishComment(publishRecord) })]
      }
      return []
    })

    const readyIdeas = await getReadyIdeas()
    const searchedIdeas = await searchIdeas('agent loops')
    const relatedIdeas = await findRelatedIdeas({
      issueNumber: 7,
      issueUrl: firstIssue.html_url,
      repoFullName: 'htekdev/content-management',
      id: 'idea-7',
      topic: firstIssue.title,
      hook: 'Hook',
      audience: 'Audience',
      keyTakeaway: 'Takeaway',
      talkingPoints: ['One'],
      platforms: [Platform.YouTube],
      status: 'ready',
      tags: ['copilot', 'agents'],
      createdAt: firstIssue.created_at,
      updatedAt: firstIssue.updated_at,
      publishBy: '2026-03-01',
    })
    const publishHistory = await getPublishHistory(7)

    expect(readyIdeas).toHaveLength(1)
    expect(searchedIdeas).toHaveLength(1)
    expect(relatedIdeas).toHaveLength(1)
    expect(relatedIdeas[0]).toMatchObject({ issueNumber: 8 })
    expect(publishHistory).toEqual([publishRecord])
    expect(mockGitHubClient.listIssues).toHaveBeenNthCalledWith(1, expect.objectContaining({ labels: ['status:ready'] }))
    expect(mockGitHubClient.searchIssues).toHaveBeenCalledWith('agent loops')
  })

  it('ideaService.REQ-004 - listIdeas builds label filters, hydrates comments, and honors limit', async () => {
    const firstIssue = createIssue({ number: 11, title: 'Filtered idea', labels: ['status:ready', 'platform:youtube', 'priority:hot-trend', 'copilot-launch'] })
    const secondIssue = createIssue({ number: 12, title: 'Second idea', labels: ['status:ready', 'platform:youtube', 'priority:hot-trend', 'copilot-launch'] })
    mockGitHubClient.listIssues.mockResolvedValue([firstIssue, secondIssue])
    mockGitHubClient.listComments.mockResolvedValue([])

    const ideas = await listIdeas({
      status: 'ready',
      platform: Platform.YouTube,
      tag: 'Copilot Launch',
      priority: 'hot-trend',
      limit: 1,
    })

    expect(mockGitHubClient.listIssues).toHaveBeenCalledWith({
      labels: ['status:ready', 'platform:youtube', 'copilot-launch', 'priority:hot-trend'],
      maxResults: 1,
    })
    expect(mockGitHubClient.listComments).toHaveBeenNthCalledWith(1, 11)
    expect(mockGitHubClient.listComments).toHaveBeenNthCalledWith(2, 12)
    expect(ideas).toHaveLength(1)
    expect(ideas[0]).toMatchObject({ issueNumber: 11 })
  })

  it('ideaService.REQ-009 ideaService.REQ-014 - recordPublish adds a structured publish-record comment when needed and ensures the idea is labeled published', async () => {
    const publishRecord = createPublishRecord({ queueItemId: 'queue-new' })
    mockGitHubClient.getIssue.mockResolvedValue(createIssue({ labels: ['status:recorded', 'platform:youtube', 'copilot'] }))
    mockGitHubClient.listComments.mockResolvedValue([])

    await recordPublish(42, publishRecord)

    expect(mockGitHubClient.addComment).toHaveBeenCalledWith(42, expect.stringContaining('<!-- vidpipe:idea-comment -->'))
    expect(mockGitHubClient.addComment).toHaveBeenCalledWith(42, expect.stringContaining('"type": "publish-record"'))
    expect(mockGitHubClient.updateIssue).toHaveBeenCalledWith(42, expect.objectContaining({
      labels: expect.arrayContaining(['status:published', 'platform:youtube', 'copilot']),
    }))
  })

  it('ideaService.REQ-011 - getReadyIdeas, markRecorded, and markPublished delegate to list and lifecycle helpers', async () => {
    const publishRecord = createPublishRecord({ queueItemId: 'queue-delegate' })
    mockGitHubClient.listIssues.mockResolvedValue([])
    mockGitHubClient.getIssue.mockResolvedValue(createIssue({ labels: ['status:ready', 'platform:youtube', 'copilot'] }))
    mockGitHubClient.listComments.mockResolvedValue([])

    await getReadyIdeas()
    await markRecorded(42, 'video-delegate')
    await markPublished(42, publishRecord)

    expect(mockGitHubClient.listIssues).toHaveBeenCalledWith({ labels: ['status:ready'], maxResults: undefined })
    expect(mockGitHubClient.addComment).toHaveBeenNthCalledWith(1, 42, expect.stringContaining('"type": "video-link"'))
    expect(mockGitHubClient.addComment).toHaveBeenNthCalledWith(2, 42, expect.stringContaining('"type": "publish-record"'))
  })

  it('ideaService.REQ-012 - getIdea falls back publishBy to the issue creation date when the markdown omits Publish By', async () => {
    mockGitHubClient.getIssue.mockResolvedValue(createIssue({
      body: [
        '## Hook',
        'Fallback publish-by',
        '',
        '## Audience',
        'Developers',
        '',
        '## Key Takeaway',
        'Use issue timestamps when Publish By is missing.',
        '',
        '## Talking Points',
        '- One',
      ].join('\n'),
      created_at: '2026-02-20T12:34:56.000Z',
    }))
    mockGitHubClient.listComments.mockResolvedValue([])

    const idea = await getIdea(42)

    expect(idea?.publishBy).toBe('2026-02-20')
  })

  it('ideaService.REQ-016 - getIdea logs and rethrows non-404 failures with operation context', async () => {
    mockGitHubClient.getIssue.mockRejectedValueOnce(new Error('boom'))
    mockGitHubClient.listComments.mockResolvedValue([])

    await expect(getIdea(42)).rejects.toThrow('Failed to get idea #42: boom')
    expect(logger.error).toHaveBeenCalledWith('[IdeaService] Failed to get idea #42: boom')
  })
})
