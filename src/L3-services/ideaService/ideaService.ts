import { Platform } from '../../L0-pure/types/index.js'
import type {
  CreateIdeaInput,
  Idea,
  IdeaCommentData,
  IdeaFilters,
  IdeaPublishRecord,
  IdeaStatus,
} from '../../L0-pure/types/index.js'
import {
  GitHubClientError,
  getGitHubClient,
  type GitHubComment,
  type GitHubIssue,
} from '../../L2-clients/github/githubClient.js'
import { getConfig } from '../../L1-infra/config/environment.js'
import logger from '../../L1-infra/logger/configLogger.js'

const STATUS_LABEL_PREFIX = 'status:'
const PLATFORM_LABEL_PREFIX = 'platform:'
const PRIORITY_LABEL_PREFIX = 'priority:'
const COMMENT_MARKER = '<!-- vidpipe:idea-comment -->'
const MARKDOWN_SECTION_PREFIX = '## '
const platformValues = new Set<Platform>(Object.values(Platform))
const ideaStatuses = new Set<IdeaStatus>(['draft', 'ready', 'recorded', 'published'])

type IdeaPriority = IdeaFilters['priority']

interface IdeaBodyData {
  hook: string
  audience: string
  keyTakeaway: string
  talkingPoints: string[]
  publishBy: string
  trendContext?: string
}

interface IdeaLabelData {
  status: IdeaStatus
  platforms: Platform[]
  tags: string[]
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sanitizeMultilineValue(value: string | undefined): string {
  return (value ?? '').trim()
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '-')
}

function normalizeTags(tags: readonly string[]): string[] {
  return Array.from(new Set(tags.map((tag) => normalizeTag(tag)).filter((tag) => tag.length > 0)))
}

function isPlatform(value: string): value is Platform {
  return platformValues.has(value as Platform)
}

function isIdeaStatus(value: string): value is IdeaStatus {
  return ideaStatuses.has(value as IdeaStatus)
}

function uniquePlatforms(platforms: readonly Platform[]): Platform[] {
  return Array.from(new Set(platforms))
}

function classifyIdeaPriority(publishBy: string, createdAtIso: string): IdeaPriority {
  const publishByTimestamp = new Date(publishBy).getTime()
  const createdAtTimestamp = new Date(createdAtIso).getTime()

  if (Number.isNaN(publishByTimestamp) || Number.isNaN(createdAtTimestamp)) {
    return 'evergreen'
  }

  const diffDays = Math.ceil((publishByTimestamp - createdAtTimestamp) / (1000 * 60 * 60 * 24))
  if (diffDays <= 7) {
    return 'hot-trend'
  }
  if (diffDays <= 14) {
    return 'timely'
  }

  return 'evergreen'
}

function extractLabelsFromIdea(
  idea: Pick<Idea, 'status' | 'platforms' | 'tags'>,
  publishBy: string,
  createdAtIso: string,
): string[] {
  const labels = [
    `${STATUS_LABEL_PREFIX}${idea.status}`,
    ...uniquePlatforms(idea.platforms).map((platform) => `${PLATFORM_LABEL_PREFIX}${platform}`),
    `${PRIORITY_LABEL_PREFIX}${classifyIdeaPriority(publishBy, createdAtIso)}`,
    ...normalizeTags(idea.tags),
  ]

  return Array.from(new Set(labels))
}

function parseLabelsToIdea(labels: readonly string[]): IdeaLabelData {
  let status: IdeaStatus = 'draft'
  const platforms: Platform[] = []
  const tags: string[] = []

  for (const label of labels) {
    const normalized = label.trim().toLowerCase()
    if (!normalized) {
      continue
    }

    if (normalized.startsWith(STATUS_LABEL_PREFIX)) {
      const value = normalized.slice(STATUS_LABEL_PREFIX.length)
      if (isIdeaStatus(value)) {
        status = value
      }
      continue
    }

    if (normalized.startsWith(PLATFORM_LABEL_PREFIX)) {
      const value = normalized.slice(PLATFORM_LABEL_PREFIX.length)
      if (isPlatform(value)) {
        platforms.push(value)
      }
      continue
    }

    if (normalized.startsWith(PRIORITY_LABEL_PREFIX)) {
      continue
    }

    tags.push(normalized)
  }

  return {
    status,
    platforms: uniquePlatforms(platforms),
    tags: Array.from(new Set(tags)),
  }
}

function formatIdeaBody(input: Pick<CreateIdeaInput, 'hook' | 'audience' | 'keyTakeaway' | 'talkingPoints' | 'publishBy' | 'trendContext'>): string {
  const sections = [
    `${MARKDOWN_SECTION_PREFIX}Hook`,
    sanitizeMultilineValue(input.hook),
    '',
    `${MARKDOWN_SECTION_PREFIX}Audience`,
    sanitizeMultilineValue(input.audience),
    '',
    `${MARKDOWN_SECTION_PREFIX}Key Takeaway`,
    sanitizeMultilineValue(input.keyTakeaway),
    '',
    `${MARKDOWN_SECTION_PREFIX}Talking Points`,
    ...input.talkingPoints.map((point) => `- ${sanitizeMultilineValue(point)}`),
    '',
    `${MARKDOWN_SECTION_PREFIX}Publish By`,
    sanitizeMultilineValue(input.publishBy),
  ]

  const trendContext = sanitizeMultilineValue(input.trendContext)
  if (trendContext) {
    sections.push('', `${MARKDOWN_SECTION_PREFIX}Trend Context`, trendContext)
  }

  return sections.join('\n').trim()
}

function parseIdeaBody(body: string, fallbackPublishBy: string): IdeaBodyData {
  const normalizedBody = body.replace(/\r\n/g, '\n')
  const sections = new Map<string, string[]>()
  let currentSection: string | null = null

  for (const line of normalizedBody.split('\n')) {
    if (line.startsWith(MARKDOWN_SECTION_PREFIX)) {
      currentSection = line.slice(MARKDOWN_SECTION_PREFIX.length).trim()
      sections.set(currentSection, [])
      continue
    }

    if (currentSection) {
      sections.get(currentSection)?.push(line)
    }
  }

  const getSection = (heading: string): string => (sections.get(heading) ?? []).join('\n').trim()
  const talkingPointsSection = sections.get('Talking Points') ?? []
  const talkingPoints = talkingPointsSection
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') || line.startsWith('* '))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0)

  return {
    hook: getSection('Hook'),
    audience: getSection('Audience'),
    keyTakeaway: getSection('Key Takeaway'),
    talkingPoints,
    publishBy: getSection('Publish By') || fallbackPublishBy,
    trendContext: getSection('Trend Context') || undefined,
  }
}

function formatIdeaComment(data: IdeaCommentData): string {
  return [
    COMMENT_MARKER,
    '```json',
    JSON.stringify(data, null, 2),
    '```',
  ].join('\n')
}

function formatPublishRecordComment(record: IdeaPublishRecord): string {
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
    formatIdeaComment({ type: 'publish-record', record }),
  ].join('\n')
}

function formatVideoLinkComment(videoSlug: string, linkedAt: string): string {
  return [
    'Linked a source video to this idea.',
    '',
    `- Video slug: ${videoSlug}`,
    `- Linked at: ${linkedAt}`,
    '',
    formatIdeaComment({ type: 'video-link', videoSlug, linkedAt }),
  ].join('\n')
}

function parseIdeaComment(commentBody: string): IdeaCommentData | null {
  const markerIndex = commentBody.indexOf(COMMENT_MARKER)
  if (markerIndex === -1) {
    return null
  }

  const commentPayload = commentBody.slice(markerIndex + COMMENT_MARKER.length)
  const fencedJsonMatch = commentPayload.match(/```json\s*([\s\S]*?)\s*```/)
  const jsonText = fencedJsonMatch?.[1]?.trim() ?? commentPayload.trim()
  if (!jsonText) {
    return null
  }

  try {
    const parsed = JSON.parse(jsonText) as Partial<IdeaCommentData> & {
      type?: string
      record?: Partial<IdeaPublishRecord>
      videoSlug?: unknown
      linkedAt?: unknown
    }

    if (parsed.type === 'video-link' && typeof parsed.videoSlug === 'string' && typeof parsed.linkedAt === 'string') {
      return {
        type: 'video-link',
        videoSlug: parsed.videoSlug,
        linkedAt: parsed.linkedAt,
      }
    }

    if (parsed.type === 'publish-record' && parsed.record) {
      const record = parsed.record
      if (
        typeof record.clipType === 'string'
        && typeof record.platform === 'string'
        && isPlatform(record.platform)
        && typeof record.queueItemId === 'string'
        && typeof record.publishedAt === 'string'
        && typeof record.latePostId === 'string'
        && typeof record.lateUrl === 'string'
      ) {
        return {
          type: 'publish-record',
          record: {
            clipType: record.clipType as IdeaPublishRecord['clipType'],
            platform: record.platform,
            queueItemId: record.queueItemId,
            publishedAt: record.publishedAt,
            latePostId: record.latePostId,
            lateUrl: record.lateUrl,
          },
        }
      }
    }
  } catch {
    return null
  }

  return null
}

function buildLabelFilters(filters?: IdeaFilters): string[] {
  if (!filters) {
    return []
  }

  const labels: string[] = []
  if (filters.status) {
    labels.push(`${STATUS_LABEL_PREFIX}${filters.status}`)
  }
  if (filters.platform) {
    labels.push(`${PLATFORM_LABEL_PREFIX}${filters.platform}`)
  }
  if (filters.tag) {
    labels.push(normalizeTag(filters.tag))
  }
  if (filters.priority) {
    labels.push(`${PRIORITY_LABEL_PREFIX}${filters.priority}`)
  }

  return labels
}

function buildLabelsFromIssue(
  issue: GitHubIssue,
  overrides: Partial<Pick<Idea, 'status' | 'platforms' | 'tags'>> = {},
): string[] {
  const parsedLabels = parseLabelsToIdea(issue.labels)
  const parsedBody = parseIdeaBody(issue.body, issue.created_at.slice(0, 10))

  return extractLabelsFromIdea(
    {
      status: overrides.status ?? parsedLabels.status,
      platforms: overrides.platforms ?? parsedLabels.platforms,
      tags: overrides.tags ?? parsedLabels.tags,
    },
    parsedBody.publishBy,
    issue.created_at,
  )
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof GitHubClientError && error.status === 404
}

function mapIssueToIdea(issue: GitHubIssue, comments: GitHubComment[]): Idea {
  const config = getConfig()
  const parsedLabels = parseLabelsToIdea(issue.labels)
  const parsedBody = parseIdeaBody(issue.body, issue.created_at.slice(0, 10))
  const publishRecords: IdeaPublishRecord[] = []
  let sourceVideoSlug: string | undefined

  for (const comment of comments) {
    const parsedComment = parseIdeaComment(comment.body)
    if (!parsedComment) {
      continue
    }

    if (parsedComment.type === 'publish-record') {
      publishRecords.push(parsedComment.record)
      continue
    }

    sourceVideoSlug = parsedComment.videoSlug
  }

  return {
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    repoFullName: config.IDEAS_REPO,
    id: `idea-${issue.number}`,
    topic: issue.title,
    ...parsedBody,
    ...parsedLabels,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    sourceVideoSlug,
    publishedContent: publishRecords.length > 0 ? publishRecords : undefined,
  }
}

export async function createIdea(input: CreateIdeaInput): Promise<Idea> {
  const client = getGitHubClient()
  const createdAt = new Date().toISOString()

  try {
    const issue = await client.createIssue({
      title: input.topic,
      body: formatIdeaBody(input),
      labels: extractLabelsFromIdea(
        {
          status: 'draft',
          platforms: input.platforms,
          tags: input.tags,
        },
        input.publishBy,
        createdAt,
      ),
    })

    logger.info(`[IdeaService] Created idea #${issue.number}: ${input.topic}`)
    return mapIssueToIdea(issue, [])
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    logger.error(`[IdeaService] Failed to create idea "${input.topic}": ${message}`)
    throw new Error(`Failed to create idea "${input.topic}": ${message}`)
  }
}

export async function updateIdea(
  issueNumber: number,
  updates: Partial<CreateIdeaInput> & { status?: IdeaStatus },
): Promise<Idea> {
  const client = getGitHubClient()

  try {
    const currentIdea = await getIdea(issueNumber)
    if (!currentIdea) {
      throw new Error(`Idea #${issueNumber} was not found`)
    }

    const nextInput: CreateIdeaInput = {
      topic: updates.topic ?? currentIdea.topic,
      hook: updates.hook ?? currentIdea.hook,
      audience: updates.audience ?? currentIdea.audience,
      keyTakeaway: updates.keyTakeaway ?? currentIdea.keyTakeaway,
      talkingPoints: updates.talkingPoints ?? currentIdea.talkingPoints,
      platforms: updates.platforms ?? currentIdea.platforms,
      tags: updates.tags ?? currentIdea.tags,
      publishBy: updates.publishBy ?? currentIdea.publishBy,
      trendContext: updates.trendContext ?? currentIdea.trendContext,
    }

    const shouldUpdateBody = updates.hook !== undefined
      || updates.audience !== undefined
      || updates.keyTakeaway !== undefined
      || updates.talkingPoints !== undefined
      || updates.publishBy !== undefined
      || updates.trendContext !== undefined

    const shouldUpdateLabels = updates.status !== undefined
      || updates.platforms !== undefined
      || updates.tags !== undefined
      || updates.publishBy !== undefined

    const issue = await client.updateIssue(issueNumber, {
      title: updates.topic,
      body: shouldUpdateBody ? formatIdeaBody(nextInput) : undefined,
      labels: shouldUpdateLabels
        ? extractLabelsFromIdea(
          {
            status: updates.status ?? currentIdea.status,
            platforms: nextInput.platforms,
            tags: nextInput.tags,
          },
          nextInput.publishBy,
          currentIdea.createdAt,
        )
        : undefined,
    })
    const comments = await client.listComments(issueNumber)

    return mapIssueToIdea(issue, comments)
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    logger.error(`[IdeaService] Failed to update idea #${issueNumber}: ${message}`)
    throw new Error(`Failed to update idea #${issueNumber}: ${message}`)
  }
}

export async function getIdea(issueNumber: number): Promise<Idea | null> {
  const client = getGitHubClient()

  try {
    const [issue, comments] = await Promise.all([
      client.getIssue(issueNumber),
      client.listComments(issueNumber),
    ])

    return mapIssueToIdea(issue, comments)
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return null
    }

    const message = getErrorMessage(error)
    logger.error(`[IdeaService] Failed to get idea #${issueNumber}: ${message}`)
    throw new Error(`Failed to get idea #${issueNumber}: ${message}`)
  }
}

export async function listIdeas(filters?: IdeaFilters): Promise<Idea[]> {
  const client = getGitHubClient()

  try {
    const issues = await client.listIssues({
      labels: buildLabelFilters(filters),
      maxResults: filters?.limit,
    })
    const ideas = await Promise.all(
      issues.map(async (issue) => {
        const comments = await client.listComments(issue.number)
        return mapIssueToIdea(issue, comments)
      }),
    )

    return filters?.limit ? ideas.slice(0, filters.limit) : ideas
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    logger.error(`[IdeaService] Failed to list ideas: ${message}`)
    throw new Error(`Failed to list ideas: ${message}`)
  }
}

export async function searchIdeas(query: string): Promise<Idea[]> {
  const client = getGitHubClient()

  try {
    const issues = await client.searchIssues(query)
    return await Promise.all(
      issues.map(async (issue) => {
        const comments = await client.listComments(issue.number)
        return mapIssueToIdea(issue, comments)
      }),
    )
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    logger.error(`[IdeaService] Failed to search ideas: ${message}`)
    throw new Error(`Failed to search ideas: ${message}`)
  }
}

export async function findRelatedIdeas(idea: Idea): Promise<Idea[]> {
  const client = getGitHubClient()

  try {
    const relatedIssues = new Map<number, GitHubIssue>()
    for (const tag of normalizeTags(idea.tags)) {
      const matches = await client.listIssues({ labels: [tag], maxResults: 5 })
      for (const match of matches) {
        if (match.number !== idea.issueNumber) {
          relatedIssues.set(match.number, match)
        }
      }
    }

    const sortedIssues = Array.from(relatedIssues.values())
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, 5)

    return await Promise.all(
      sortedIssues.map(async (issue) => {
        const comments = await client.listComments(issue.number)
        return mapIssueToIdea(issue, comments)
      }),
    )
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    logger.error(`[IdeaService] Failed to find related ideas for #${idea.issueNumber}: ${message}`)
    throw new Error(`Failed to find related ideas for #${idea.issueNumber}: ${message}`)
  }
}

export async function linkVideoToIdea(issueNumber: number, videoSlug: string): Promise<void> {
  const client = getGitHubClient()

  try {
    const [issue] = await Promise.all([
      client.getIssue(issueNumber),
      client.addComment(issueNumber, formatVideoLinkComment(videoSlug, new Date().toISOString())),
    ])

    await client.updateIssue(issueNumber, {
      labels: buildLabelsFromIssue(issue, { status: 'recorded' }),
    })
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    logger.error(`[IdeaService] Failed to link video ${videoSlug} to idea #${issueNumber}: ${message}`)
    throw new Error(`Failed to link video ${videoSlug} to idea #${issueNumber}: ${message}`)
  }
}

export async function recordPublish(issueNumber: number, record: IdeaPublishRecord): Promise<void> {
  const client = getGitHubClient()

  try {
    const [issue, comments] = await Promise.all([
      client.getIssue(issueNumber),
      client.listComments(issueNumber),
    ])

    const hasDuplicate = comments.some((comment) => {
      const parsedComment = parseIdeaComment(comment.body)
      return parsedComment?.type === 'publish-record' && parsedComment.record.queueItemId === record.queueItemId
    })

    if (!hasDuplicate) {
      await client.addComment(issueNumber, formatPublishRecordComment(record))
    }

    if (!issue.labels.includes(`${STATUS_LABEL_PREFIX}published`)) {
      await client.updateIssue(issueNumber, {
        labels: buildLabelsFromIssue(issue, { status: 'published' }),
      })
    }
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    logger.error(`[IdeaService] Failed to record publish for idea #${issueNumber}: ${message}`)
    throw new Error(`Failed to record publish for idea #${issueNumber}: ${message}`)
  }
}

export async function getPublishHistory(issueNumber: number): Promise<IdeaPublishRecord[]> {
  const client = getGitHubClient()

  try {
    const comments = await client.listComments(issueNumber)
    return comments.flatMap((comment) => {
      const parsedComment = parseIdeaComment(comment.body)
      return parsedComment?.type === 'publish-record' ? [parsedComment.record] : []
    })
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    logger.error(`[IdeaService] Failed to get publish history for idea #${issueNumber}: ${message}`)
    throw new Error(`Failed to get publish history for idea #${issueNumber}: ${message}`)
  }
}

export async function getReadyIdeas(): Promise<Idea[]> {
  return listIdeas({ status: 'ready' })
}

export async function markRecorded(issueNumber: number, videoSlug: string): Promise<void> {
  await linkVideoToIdea(issueNumber, videoSlug)
}

export async function markPublished(issueNumber: number, record: IdeaPublishRecord): Promise<void> {
  await recordPublish(issueNumber, record)
}
