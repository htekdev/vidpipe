import {
  Platform,
  type Idea,
  type IdeaCommentData,
  type IdeaPublishRecord,
  type IdeaStatus,
} from '../types/index.js'

const ideaStatuses = ['draft', 'ready', 'recorded', 'published'] as const
const clipTypes = ['video', 'short', 'medium'] as const
const jsonBlockPattern = /```json\s*([\s\S]*?)\s*```/gi
const millisecondsPerDay = 24 * 60 * 60 * 1000

/** Formats an idea into the structured markdown body stored in a GitHub issue. */
export function formatIdeaBody(
  idea: Pick<Idea, 'hook' | 'audience' | 'keyTakeaway' | 'talkingPoints' | 'publishBy' | 'trendContext'>,
): string {
  const lines: string[] = []

  appendSection(lines, 'Hook', normalizeText(idea.hook))
  appendSection(lines, 'Audience', normalizeText(idea.audience))
  appendSection(lines, 'Key Takeaway', normalizeText(idea.keyTakeaway))
  appendSection(
    lines,
    'Talking Points',
    idea.talkingPoints
      .map(point => normalizeText(point))
      .filter(point => point.length > 0)
      .map(point => `- ${point}`),
  )
  appendSection(lines, 'Publish By', normalizeText(idea.publishBy))

  const trendContext = normalizeText(idea.trendContext)
  if (trendContext.length > 0) {
    appendSection(lines, 'Trend Context', trendContext)
  }

  if (lines.at(-1) === '') {
    lines.pop()
  }

  return lines.join('\n')
}

/** Parses a structured GitHub issue body back into idea fields. */
export function parseIdeaBody(markdown: string): {
  hook: string
  audience: string
  keyTakeaway: string
  talkingPoints: string[]
  publishBy: string
  trendContext?: string
} {
  const hook = extractSection(markdown, 'Hook')
  const audience = extractSection(markdown, 'Audience')
  const keyTakeaway = extractSection(markdown, 'Key Takeaway')
  const talkingPoints = extractSection(markdown, 'Talking Points')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^-\s+/.test(line))
    .map(line => normalizeText(line.replace(/^-\s+/, '')))
    .filter(point => point.length > 0)
  const publishBy = extractSection(markdown, 'Publish By')
  const trendContext = extractSection(markdown, 'Trend Context')

  return {
    hook,
    audience,
    keyTakeaway,
    talkingPoints,
    publishBy,
    ...(trendContext.length > 0 ? { trendContext } : {}),
  }
}

/** Builds the GitHub label set derived from idea metadata. */
export function extractLabelsFromIdea(
  idea: { status: IdeaStatus; platforms: Platform[]; tags: string[] },
  publishBy?: string,
  now?: string,
): string[] {
  const labels: string[] = []

  pushUnique(labels, `status:${idea.status}`)

  for (const platform of idea.platforms) {
    pushUnique(labels, `platform:${platform}`)
  }

  for (const tag of idea.tags) {
    const normalizedTag = normalizeText(tag)
    if (normalizedTag.length > 0) {
      pushUnique(labels, normalizedTag)
    }
  }

  const priorityLabel = derivePriorityLabel(publishBy, now)
  if (priorityLabel) {
    pushUnique(labels, priorityLabel)
  }

  return labels
}

/** Restores idea status, platforms, and tags from GitHub labels. */
export function parseLabelsToIdea(labels: string[]): {
  status?: IdeaStatus
  platforms: Platform[]
  tags: string[]
} {
  const platforms: Platform[] = []
  const tags: string[] = []
  let status: IdeaStatus | undefined

  for (const label of labels) {
    const normalizedLabel = normalizeText(label)
    if (normalizedLabel.length === 0) {
      continue
    }

    if (normalizedLabel.startsWith('status:')) {
      const candidate = normalizeText(normalizedLabel.slice('status:'.length))
      if (isIdeaStatus(candidate)) {
        status = candidate
      }
      continue
    }

    if (normalizedLabel.startsWith('platform:')) {
      const candidate = normalizeText(normalizedLabel.slice('platform:'.length))
      if (isPlatform(candidate)) {
        pushUnique(platforms, candidate)
      }
      continue
    }

    if (normalizedLabel.startsWith('priority:')) {
      continue
    }

    pushUnique(tags, normalizedLabel)
  }

  return { status, platforms, tags }
}

/** Formats a structured publish-record issue comment with an embedded JSON payload. */
export function formatPublishRecordComment(record: IdeaPublishRecord): string {
  const payload = {
    type: 'publish-record',
    clipType: record.clipType,
    platform: record.platform,
    queueItemId: record.queueItemId,
    latePostId: record.latePostId,
    lateUrl: record.lateUrl,
    publishedAt: record.publishedAt,
  }

  return formatStructuredComment(
    `## ✅ Published — ${formatPlatformDisplayName(record.platform)} (${formatClipTypeDisplayName(record.clipType)})`,
    payload,
  )
}

/** Formats a structured video-link issue comment with an embedded JSON payload. */
export function formatVideoLinkComment(videoSlug: string, linkedAt: string): string {
  return formatStructuredComment('## 📹 Linked Recording', {
    type: 'video-link',
    videoSlug,
    linkedAt,
  })
}

/** Parses a structured issue comment into idea comment data when possible. */
export function parseIdeaComment(commentBody: string): IdeaCommentData | null {
  for (const match of commentBody.matchAll(jsonBlockPattern)) {
    const jsonBody = match[1]?.trim()
    if (!jsonBody) {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonBody)
    } catch {
      continue
    }

    const commentData = parseCommentPayload(parsed)
    if (commentData) {
      return commentData
    }
  }

  return null
}

function appendSection(lines: string[], title: string, content: string | readonly string[]): void {
  lines.push(`## ${title}`)

  const bodyLines = typeof content === 'string'
    ? (content.length > 0 ? content.split(/\r?\n/) : [])
    : [...content]

  lines.push(...bodyLines)
  lines.push('')
}

function extractSection(markdown: string, title: string): string {
  const sectionPattern = new RegExp(
    `(?:^|\\r?\\n)##\\s+${escapeRegExp(title)}\\s*\\r?\\n([\\s\\S]*?)(?=(?:\\r?\\n##\\s+)|$)`,
    'i',
  )
  const sectionMatch = markdown.match(sectionPattern)
  return normalizeText(sectionMatch?.[1])
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeText(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function pushUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) {
    items.push(item)
  }
}

function derivePriorityLabel(publishBy: string | undefined, now: string | undefined): string | undefined {
  if (!publishBy || !now) {
    return undefined
  }

  const publishByDate = new Date(publishBy)
  const nowDate = new Date(now)
  if (Number.isNaN(publishByDate.getTime()) || Number.isNaN(nowDate.getTime())) {
    return undefined
  }

  const daysUntilPublish = (publishByDate.getTime() - nowDate.getTime()) / millisecondsPerDay
  if (daysUntilPublish <= 7) {
    return 'priority:hot-trend'
  }
  if (daysUntilPublish <= 14) {
    return 'priority:timely'
  }
  return 'priority:evergreen'
}

function formatStructuredComment(heading: string, payload: Record<string, string>): string {
  return `${heading}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
}

function formatPlatformDisplayName(platform: Platform): string {
  switch (platform) {
    case Platform.TikTok:
      return 'TikTok'
    case Platform.YouTube:
      return 'YouTube'
    case Platform.Instagram:
      return 'Instagram'
    case Platform.LinkedIn:
      return 'LinkedIn'
    case Platform.X:
      return 'X'
  }
}

function formatClipTypeDisplayName(clipType: IdeaPublishRecord['clipType']): string {
  switch (clipType) {
    case 'video':
      return 'Video'
    case 'short':
      return 'Short'
    case 'medium':
      return 'Medium Clip'
  }
}

function parseCommentPayload(payload: unknown): IdeaCommentData | null {
  if (!isRecord(payload) || typeof payload.type !== 'string') {
    return null
  }

  if (payload.type === 'publish-record') {
    if (
      !isClipType(payload.clipType)
      || !isPlatform(payload.platform)
      || !isNonEmptyString(payload.queueItemId)
      || !isNonEmptyString(payload.latePostId)
      || !isNonEmptyString(payload.lateUrl)
      || !isNonEmptyString(payload.publishedAt)
    ) {
      return null
    }

    return {
      type: 'publish-record',
      record: {
        clipType: payload.clipType,
        platform: payload.platform,
        queueItemId: payload.queueItemId,
        latePostId: payload.latePostId,
        lateUrl: payload.lateUrl,
        publishedAt: payload.publishedAt,
      },
    }
  }

  if (payload.type === 'video-link') {
    if (!isNonEmptyString(payload.videoSlug) || !isNonEmptyString(payload.linkedAt)) {
      return null
    }

    return {
      type: 'video-link',
      videoSlug: payload.videoSlug,
      linkedAt: payload.linkedAt,
    }
  }

  return null
}

function isIdeaStatus(value: string): value is IdeaStatus {
  return (ideaStatuses as readonly string[]).includes(value)
}

function isClipType(value: unknown): value is IdeaPublishRecord['clipType'] {
  return typeof value === 'string' && (clipTypes as readonly string[]).includes(value)
}

function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && Object.values(Platform).includes(value as Platform)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
