import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { Platform, type CreateIdeaInput, type Idea, type IdeaPublishRecord, type IdeaStatus } from '../../L0-pure/types/index.js'
import { getConfig, initConfig } from '../../L1-infra/config/environment.js'
import {
  createIdea,
  linkVideoToIdea,
  recordPublish,
  searchIdeas,
  updateIdea,
} from '../../L3-services/ideaService/ideaService.js'

const DEFAULT_DELAY_MS = 1_000
const statusRank: Readonly<Record<IdeaStatus, number>> = {
  draft: 0,
  ready: 1,
  recorded: 2,
  published: 3,
}
const platformValues = new Set<Platform>(Object.values(Platform))
const ideaStatuses = new Set<IdeaStatus>(['draft', 'ready', 'recorded', 'published'])
const clipTypes = new Set<IdeaPublishRecord['clipType']>(['video', 'short', 'medium'])

export interface MigrateIdeasToGitHubOptions {
  dryRun?: boolean
  ideasDir?: string
  delayMs?: number
}

export interface MigrationMapping {
  oldId: string
  newIssueNumber: number
}

export interface MigrationFailure {
  oldId: string
  filePath: string
  message: string
}

export interface MigrationSummary {
  dryRun: boolean
  ideaCount: number
  mappings: MigrationMapping[]
  failures: MigrationFailure[]
}

interface LegacyIdeaPublishRecord {
  clipType: IdeaPublishRecord['clipType']
  platform: Platform
  queueItemId: string
  publishedAt: string
  latePostId?: string
  lateUrl?: string
}

interface IdeaSeed {
  id: string
  topic: string
  hook: string
  audience: string
  keyTakeaway: string
  talkingPoints: string[]
  platforms: Platform[]
  status: IdeaStatus
  tags: string[]
  publishBy: string
  trendContext?: string
  sourceVideoSlug?: string
  publishedContent: LegacyIdeaPublishRecord[]
  filePath: string
}

interface ParsedCliArgs extends MigrateIdeasToGitHubOptions {
  help?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPlatform(value: string): value is Platform {
  return platformValues.has(value as Platform)
}

function isIdeaStatus(value: string): value is IdeaStatus {
  return ideaStatuses.has(value as IdeaStatus)
}

function normalizeTopicKey(topic: string): string {
  return topic.trim().replace(/\s+/g, ' ').toLowerCase()
}

function escapeSearchQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertNonEmptyString(value: unknown, field: string, filePath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string in ${filePath}`)
  }

  return value.trim()
}

function readOptionalString(value: unknown, field: string, filePath: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  return assertNonEmptyString(value, field, filePath)
}

function assertStringArray(value: unknown, field: string, filePath: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array in ${filePath}`)
  }

  return value.map((item, index) => assertNonEmptyString(item, `${field}[${index}]`, filePath))
}

function assertPlatformArray(value: unknown, field: string, filePath: string): Platform[] {
  const rawPlatforms = assertStringArray(value, field, filePath)
  const platforms = rawPlatforms.map((platform, index) => {
    if (!isPlatform(platform)) {
      throw new Error(`${field}[${index}] must be a valid platform in ${filePath}`)
    }

    return platform
  })

  return Array.from(new Set(platforms))
}

function assertIdeaStatus(value: unknown, field: string, filePath: string): IdeaStatus {
  const status = assertNonEmptyString(value, field, filePath)
  if (!isIdeaStatus(status)) {
    throw new Error(`${field} must be one of ${Array.from(ideaStatuses).join(', ')} in ${filePath}`)
  }

  return status
}

function assertClipType(value: unknown, field: string, filePath: string): IdeaPublishRecord['clipType'] {
  let clipType = assertNonEmptyString(value, field, filePath)
  // Normalize legacy 'medium-clip' → 'medium' for backward compatibility
  if (clipType === 'medium-clip') clipType = 'medium'
  if (!clipTypes.has(clipType as IdeaPublishRecord['clipType'])) {
    throw new Error(`${field} must be one of ${Array.from(clipTypes).join(', ')} in ${filePath}`)
  }

  return clipType as IdeaPublishRecord['clipType']
}

function parseLegacyPublishRecord(value: unknown, filePath: string, index: number): LegacyIdeaPublishRecord {
  if (!isRecord(value)) {
    throw new Error(`publishedContent[${index}] must be an object in ${filePath}`)
  }

  const platform = assertNonEmptyString(value.platform, `publishedContent[${index}].platform`, filePath)
  if (!isPlatform(platform)) {
    throw new Error(`publishedContent[${index}].platform must be a valid platform in ${filePath}`)
  }

  return {
    clipType: assertClipType(value.clipType, `publishedContent[${index}].clipType`, filePath),
    platform,
    queueItemId: assertNonEmptyString(value.queueItemId, `publishedContent[${index}].queueItemId`, filePath),
    publishedAt: assertNonEmptyString(value.publishedAt, `publishedContent[${index}].publishedAt`, filePath),
    latePostId: readOptionalString(value.latePostId, `publishedContent[${index}].latePostId`, filePath),
    lateUrl: readOptionalString(value.lateUrl, `publishedContent[${index}].lateUrl`, filePath),
  }
}

function parsePublishedContent(value: unknown, filePath: string): LegacyIdeaPublishRecord[] {
  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value)) {
    throw new Error(`publishedContent must be an array in ${filePath}`)
  }

  return value.map((record, index) => parseLegacyPublishRecord(record, filePath, index))
}

function parseIdeaFile(filePath: string, contents: string): IdeaSeed {
  const parsed = JSON.parse(contents) as unknown
  if (!isRecord(parsed)) {
    throw new Error(`Idea file must contain a JSON object: ${filePath}`)
  }

  return {
    id: assertNonEmptyString(parsed.id, 'id', filePath),
    topic: assertNonEmptyString(parsed.topic, 'topic', filePath),
    hook: assertNonEmptyString(parsed.hook, 'hook', filePath),
    audience: assertNonEmptyString(parsed.audience, 'audience', filePath),
    keyTakeaway: assertNonEmptyString(parsed.keyTakeaway, 'keyTakeaway', filePath),
    talkingPoints: assertStringArray(parsed.talkingPoints, 'talkingPoints', filePath),
    platforms: assertPlatformArray(parsed.platforms, 'platforms', filePath),
    status: assertIdeaStatus(parsed.status, 'status', filePath),
    tags: assertStringArray(parsed.tags, 'tags', filePath),
    publishBy: assertNonEmptyString(parsed.publishBy, 'publishBy', filePath),
    trendContext: readOptionalString(parsed.trendContext, 'trendContext', filePath),
    sourceVideoSlug: readOptionalString(parsed.sourceVideoSlug, 'sourceVideoSlug', filePath),
    publishedContent: parsePublishedContent(parsed.publishedContent, filePath),
    filePath,
  }
}

function toCreateIdeaInput(idea: IdeaSeed): CreateIdeaInput {
  return {
    topic: idea.topic,
    hook: idea.hook,
    audience: idea.audience,
    keyTakeaway: idea.keyTakeaway,
    talkingPoints: idea.talkingPoints,
    platforms: idea.platforms,
    tags: idea.tags,
    publishBy: idea.publishBy,
    trendContext: idea.trendContext,
  }
}

function toPublishRecord(idea: IdeaSeed, record: LegacyIdeaPublishRecord): IdeaPublishRecord {
  return {
    clipType: record.clipType,
    platform: record.platform,
    queueItemId: record.queueItemId,
    publishedAt: record.publishedAt,
    latePostId: record.latePostId ?? `legacy-import:${idea.id}:${record.queueItemId}`,
    lateUrl: record.lateUrl ?? `legacy-import://${encodeURIComponent(record.queueItemId)}`,
  }
}

function shouldPromoteStatus(sourceStatus: IdeaStatus, currentStatus: IdeaStatus): boolean {
  return statusRank[sourceStatus] > statusRank[currentStatus]
}

function hasPublishRecord(idea: Idea, queueItemId: string): boolean {
  return (idea.publishedContent ?? []).some((record) => record.queueItemId === queueItemId)
}

async function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return
  }

  await new Promise<void>((resolveSleep) => {
    setTimeout(resolveSleep, delayMs)
  })
}

async function loadIdeaSeeds(ideasDir: string): Promise<IdeaSeed[]> {
  const entries = await readdir(ideasDir, { withFileTypes: true })
  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  return await Promise.all(
    fileNames.map(async (fileName) => {
      const filePath = join(ideasDir, fileName)
      const contents = await readFile(filePath, 'utf8')
      return parseIdeaFile(filePath, contents)
    }),
  )
}

async function findExistingIdeaByTitle(topic: string, cache: Map<string, Idea | null>): Promise<Idea | undefined> {
  const topicKey = normalizeTopicKey(topic)
  if (cache.has(topicKey)) {
    return cache.get(topicKey) ?? undefined
  }

  const matches = await searchIdeas(`in:title "${escapeSearchQuery(topic)}"`)
  const exactMatch = matches.find((match) => normalizeTopicKey(match.topic) === topicKey) ?? null
  cache.set(topicKey, exactMatch)
  return exactMatch ?? undefined
}

function buildDryRunActions(idea: IdeaSeed, existingIdea?: Idea): string[] {
  const actions: string[] = [existingIdea ? `reuse issue #${existingIdea.issueNumber}` : 'create issue']
  let predictedStatus = existingIdea?.status ?? 'draft'

  if (idea.sourceVideoSlug) {
    if (!existingIdea?.sourceVideoSlug) {
      actions.push(`link source video ${idea.sourceVideoSlug}`)
      predictedStatus = 'recorded'
    } else if (existingIdea.sourceVideoSlug !== idea.sourceVideoSlug) {
      actions.push(`skip video link (existing slug ${existingIdea.sourceVideoSlug} differs)`)
    }
  }

  const missingPublishRecords = idea.publishedContent
    .map((record) => toPublishRecord(idea, record))
    .filter((record) => !existingIdea || !hasPublishRecord(existingIdea, record.queueItemId))
  if (missingPublishRecords.length > 0) {
    actions.push(`add ${missingPublishRecords.length} publish record comment(s)`)
    predictedStatus = 'published'
  }

  if (shouldPromoteStatus(idea.status, predictedStatus)) {
    actions.push(`promote status to ${idea.status}`)
  }

  return actions
}

function printUsage(): void {
  console.log('Usage: tsx scripts/migrate-ideas-to-github.ts [--dry-run] [--ideas-dir <path>] [--delay-ms <number>]')
}

export function parseMigrateIdeasToGitHubArgs(args: readonly string[]): ParsedCliArgs {
  const parsed: ParsedCliArgs = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dry-run') {
      parsed.dryRun = true
      continue
    }

    if (arg === '--help' || arg === '-h') {
      parsed.help = true
      continue
    }

    if (arg === '--ideas-dir') {
      const value = args[index + 1]
      if (!value) {
        throw new Error('Missing value for --ideas-dir')
      }
      parsed.ideasDir = value
      index += 1
      continue
    }

    if (arg === '--delay-ms') {
      const value = args[index + 1]
      if (!value) {
        throw new Error('Missing value for --delay-ms')
      }

      const delayMs = Number.parseInt(value, 10)
      if (Number.isNaN(delayMs) || delayMs < 0) {
        throw new Error(`Invalid --delay-ms value: ${value}`)
      }

      parsed.delayMs = delayMs
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return parsed
}

export async function runMigrateIdeasToGitHub(options: MigrateIdeasToGitHubOptions = {}): Promise<MigrationSummary> {
  initConfig()
  const config = getConfig()
  if (!config.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is required to migrate ideas to GitHub')
  }
  if (!config.IDEAS_REPO) {
    throw new Error('IDEAS_REPO is required to migrate ideas to GitHub')
  }

  const ideasDir = resolve(options.ideasDir ?? join(process.cwd(), 'ideas'))
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const dryRun = options.dryRun === true
  const mappings: MigrationMapping[] = []
  const failures: MigrationFailure[] = []
  const existingIdeaCache = new Map<string, Idea | null>()

  const ideas = await loadIdeaSeeds(ideasDir)
  if (ideas.length === 0) {
    console.log(`No JSON idea files found in ${ideasDir}`)
    return {
      dryRun,
      ideaCount: 0,
      mappings,
      failures,
    }
  }

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Loaded ${ideas.length} idea file(s) from ${ideasDir}`)

  for (const idea of ideas) {
    try {
      let currentIdea = await findExistingIdeaByTitle(idea.topic, existingIdeaCache)
      const baselineStatus = currentIdea?.status ?? 'draft'

      if (dryRun) {
        const actions = buildDryRunActions(idea, currentIdea)
        console.log(`[DRY RUN] ${idea.id} (${idea.topic}) -> ${actions.join('; ')}`)
        continue
      }

      if (!currentIdea) {
        console.log(`Creating issue for ${idea.id}: ${idea.topic}`)
        currentIdea = await createIdea(toCreateIdeaInput(idea))
        existingIdeaCache.set(normalizeTopicKey(idea.topic), currentIdea)
        await sleep(delayMs)
      } else {
        console.log(`Reusing existing issue #${currentIdea.issueNumber} for ${idea.id}: ${idea.topic}`)
      }

      mappings.push({
        oldId: idea.id,
        newIssueNumber: currentIdea.issueNumber,
      })

      if (idea.sourceVideoSlug) {
        if (!currentIdea.sourceVideoSlug) {
          console.log(`  Linking source video ${idea.sourceVideoSlug}`)
          await linkVideoToIdea(currentIdea.issueNumber, idea.sourceVideoSlug)
          currentIdea = {
            ...currentIdea,
            sourceVideoSlug: idea.sourceVideoSlug,
            status: 'recorded',
          }
          existingIdeaCache.set(normalizeTopicKey(idea.topic), currentIdea)
          await sleep(delayMs)
        } else if (currentIdea.sourceVideoSlug !== idea.sourceVideoSlug) {
          console.warn(`  Skipping source video link for ${idea.id}; existing issue already references ${currentIdea.sourceVideoSlug}`)
        }
      }

      for (const legacyRecord of idea.publishedContent) {
        const publishRecord = toPublishRecord(idea, legacyRecord)
        if (hasPublishRecord(currentIdea, publishRecord.queueItemId)) {
          continue
        }

        if (!legacyRecord.latePostId || !legacyRecord.lateUrl) {
          console.warn(`  Publish record ${publishRecord.queueItemId} is missing Late metadata; using legacy import placeholders.`)
        }

        console.log(`  Recording published content ${publishRecord.queueItemId}`)
        await recordPublish(currentIdea.issueNumber, publishRecord)
        currentIdea = {
          ...currentIdea,
          status: 'published',
          publishedContent: [...(currentIdea.publishedContent ?? []), publishRecord],
        }
        existingIdeaCache.set(normalizeTopicKey(idea.topic), currentIdea)
        await sleep(delayMs)
      }

      const desiredStatus = shouldPromoteStatus(idea.status, baselineStatus)
        ? idea.status
        : baselineStatus

      if (shouldPromoteStatus(desiredStatus, currentIdea.status)) {
        console.log(`  Promoting status to ${desiredStatus}`)
        currentIdea = await updateIdea(currentIdea.issueNumber, { status: desiredStatus })
        existingIdeaCache.set(normalizeTopicKey(idea.topic), currentIdea)
        await sleep(delayMs)
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error)
      failures.push({
        oldId: idea.id,
        filePath: idea.filePath,
        message,
      })
      console.error(`Failed to migrate ${idea.id} from ${idea.filePath}: ${message}`)
    }
  }

  if (!dryRun) {
    console.log('Migration mappings:')
    console.log(JSON.stringify(mappings, null, 2))
  }

  if (failures.length > 0) {
    console.error(`Migration completed with ${failures.length} failure(s).`)
  } else {
    console.log(`${dryRun ? 'Dry run completed' : 'Migration completed'} successfully.`)
  }

  return {
    dryRun,
    ideaCount: ideas.length,
    mappings,
    failures,
  }
}

export async function runMigrateIdeasToGitHubCli(args: readonly string[] = process.argv.slice(2)): Promise<MigrationSummary> {
  const parsedArgs = parseMigrateIdeasToGitHubArgs(args)
  if (parsedArgs.help) {
    printUsage()
    return {
      dryRun: parsedArgs.dryRun === true,
      ideaCount: 0,
      mappings: [],
      failures: [],
    }
  }

  return await runMigrateIdeasToGitHub(parsedArgs)
}
