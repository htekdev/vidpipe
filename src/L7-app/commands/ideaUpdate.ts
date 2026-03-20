import { initConfig } from '../../L1-infra/config/environment.js'
import { updateIdea, getIdea } from '../../L3-services/ideaService/ideaService.js'
import { Platform } from '../../L0-pure/types/index.js'
import type { IdeaStatus } from '../../L0-pure/types/index.js'

const VALID_PLATFORMS = new Set(Object.values(Platform))
const VALID_STATUSES = new Set(['draft', 'ready', 'recorded', 'published'] as const)
const VALID_URGENCIES = new Map<string, number>([
  ['hot', 3],        // 3 days from now
  ['urgent', 7],     // 7 days (= hot-trend)
  ['soon', 14],      // 14 days (= timely)
  ['flexible', 60],  // 60 days (= evergreen)
])

export interface IdeaUpdateOptions {
  topic?: string
  hook?: string
  audience?: string
  platforms?: string
  keyTakeaway?: string
  talkingPoints?: string
  tags?: string
  status?: string
  publishBy?: string
  urgency?: string
  trendContext?: string
}

function parsePlatforms(raw?: string): Platform[] | undefined {
  if (!raw) return undefined
  return raw.split(',').map(p => p.trim().toLowerCase()).filter(p => VALID_PLATFORMS.has(p as Platform)) as Platform[]
}

function parseCommaSeparated(raw?: string): string[] | undefined {
  if (!raw) return undefined
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

function resolveUrgency(urgency: string): string {
  const days = VALID_URGENCIES.get(urgency.toLowerCase())
  if (days === undefined) {
    throw new Error(`Invalid urgency: ${urgency}. Must be one of: ${[...VALID_URGENCIES.keys()].join(', ')}`)
  }
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().split('T')[0]
}

export async function runIdeaUpdate(issueNumber: string, options: IdeaUpdateOptions): Promise<void> {
  initConfig()

  const num = parseInt(issueNumber, 10)
  if (!isFinite(num) || num <= 0) {
    console.error(`Invalid issue number: ${issueNumber}`)
    process.exitCode = 1
    return
  }

  // Validate status
  if (options.status && !VALID_STATUSES.has(options.status as IdeaStatus)) {
    console.error(`Invalid status: ${options.status}. Must be one of: ${[...VALID_STATUSES].join(', ')}`)
    process.exitCode = 1
    return
  }

  // Resolve urgency to publishBy date
  let publishBy = options.publishBy
  if (options.urgency) {
    try {
      publishBy = resolveUrgency(options.urgency)
    } catch (err) {
      console.error((err as Error).message)
      process.exitCode = 1
      return
    }
  }

  const updates: Record<string, unknown> = {}
  if (options.topic !== undefined) updates.topic = options.topic
  if (options.hook !== undefined) updates.hook = options.hook
  if (options.audience !== undefined) updates.audience = options.audience
  if (options.keyTakeaway !== undefined) updates.keyTakeaway = options.keyTakeaway
  if (options.trendContext !== undefined) updates.trendContext = options.trendContext
  if (options.status !== undefined) updates.status = options.status as IdeaStatus

  const platforms = parsePlatforms(options.platforms)
  if (platforms) updates.platforms = platforms

  const talkingPoints = parseCommaSeparated(options.talkingPoints)
  if (talkingPoints) updates.talkingPoints = talkingPoints

  const tags = parseCommaSeparated(options.tags)
  if (tags) updates.tags = tags

  if (publishBy) updates.publishBy = publishBy

  if (Object.keys(updates).length === 0) {
    console.error('No updates specified. Use --topic, --status, --urgency, etc.')
    process.exitCode = 1
    return
  }

  try {
    const idea = await updateIdea(num, updates)
    console.log(`✅ Idea #${idea.issueNumber} updated: ${idea.topic}`)
    console.log(`   Status: ${idea.status}`)
    console.log(`   Publish by: ${idea.publishBy}`)
    console.log(`   URL: ${idea.issueUrl}`)
  } catch (err) {
    console.error(`Failed to update idea #${num}: ${(err as Error).message}`)
    process.exitCode = 1
  }
}

export async function runIdeaGet(issueNumber: string): Promise<void> {
  initConfig()

  const num = parseInt(issueNumber, 10)
  if (!isFinite(num) || num <= 0) {
    console.error(`Invalid issue number: ${issueNumber}`)
    process.exitCode = 1
    return
  }

  try {
    const idea = await getIdea(num)
    if (!idea) {
      console.error(`Idea #${num} not found`)
      process.exitCode = 1
      return
    }
    console.log(`\n📋 Idea #${idea.issueNumber}: ${idea.topic}`)
    console.log(`   Status:       ${idea.status}`)
    console.log(`   Hook:         ${idea.hook}`)
    console.log(`   Audience:     ${idea.audience}`)
    console.log(`   Key Takeaway: ${idea.keyTakeaway}`)
    console.log(`   Platforms:    ${idea.platforms.join(', ')}`)
    console.log(`   Tags:         ${idea.tags.join(', ') || '(none)'}`)
    console.log(`   Publish by:   ${idea.publishBy}`)
    if (idea.trendContext) console.log(`   Trend:        ${idea.trendContext}`)
    if (idea.talkingPoints.length > 0) {
      console.log(`   Talking Points:`)
      for (const pt of idea.talkingPoints) {
        console.log(`     • ${pt}`)
      }
    }
    console.log(`   URL:          ${idea.issueUrl}`)
    console.log()
  } catch (err) {
    console.error(`Failed to get idea #${num}: ${(err as Error).message}`)
    process.exitCode = 1
  }
}
