import type { Idea, IdeaPublishRecord, IdeaStatus, Platform } from '../../L0-pure/types/index.js'
import {
  ensureDirectory,
  fileExists,
  listDirectory,
  readJsonFile,
  removeFile,
  writeJsonFile,
} from '../fileSystem/fileSystem.js'
import logger from '../logger/configLogger.js'
import { join, resolve } from '../paths/paths.js'

const DEFAULT_IDEAS_DIR = join(resolve('.'), 'ideas')
const IDEA_FILE_EXTENSION = '.json'
const ideaStatuses = new Set(['draft', 'ready', 'recorded', 'published'])
const ideaClipTypes = new Set(['video', 'short', 'medium-clip'])
const ideaPlatforms = new Set(['tiktok', 'youtube', 'instagram', 'linkedin', 'x'])

function resolveIdeasDir(dir?: string): string {
  return dir ? resolve(dir) : DEFAULT_IDEAS_DIR
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function validateIdeaId(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
    throw new Error(`Invalid idea ID: ${id}`)
  }
  return id
}

function getIdeaFilePath(id: string, dir?: string): string {
  return join(resolveIdeasDir(dir), `${validateIdeaId(id)}${IDEA_FILE_EXTENSION}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isIdeaStatus(value: unknown): value is IdeaStatus {
  return typeof value === 'string' && ideaStatuses.has(value)
}

function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && ideaPlatforms.has(value)
}

function isPlatformArray(value: unknown): value is Platform[] {
  return Array.isArray(value) && value.every((item) => isPlatform(item))
}

function isValidIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
}

function isIdeaPublishRecord(value: unknown): value is IdeaPublishRecord {
  return isRecord(value)
    && typeof value.queueItemId === 'string'
    && typeof value.publishedAt === 'string'
    && typeof value.clipType === 'string'
    && ideaClipTypes.has(value.clipType)
    && isPlatform(value.platform)
    && (value.publishedUrl === undefined || typeof value.publishedUrl === 'string')
}

function isIdea(value: unknown): value is Idea {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.topic === 'string'
    && typeof value.hook === 'string'
    && typeof value.audience === 'string'
    && typeof value.keyTakeaway === 'string'
    && isStringArray(value.talkingPoints)
    && isPlatformArray(value.platforms)
    && isIdeaStatus(value.status)
    && isStringArray(value.tags)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && isValidIsoDateString(value.publishBy)
    && (value.sourceVideoSlug === undefined || typeof value.sourceVideoSlug === 'string')
    && (value.trendContext === undefined || typeof value.trendContext === 'string')
    && (value.publishedContent === undefined
      || (Array.isArray(value.publishedContent) && value.publishedContent.every((item) => isIdeaPublishRecord(item))))
}

/**
 * Read all ideas from the ideas directory.
 * Each idea is a separate `{id}.json` file.
 * Returns empty array if directory doesn't exist.
 */
export async function readIdeaBank(dir?: string): Promise<Idea[]> {
  const ideasDir = resolveIdeasDir(dir)
  const ideaIds = await listIdeaIds(ideasDir)
  const ideas = await Promise.all(
    ideaIds.map(async (id) => {
      try {
        return await readIdea(id, ideasDir)
      } catch (error: unknown) {
        logger.warn(`Skipping invalid idea file ${id}${IDEA_FILE_EXTENSION}: ${getErrorMessage(error)}`)
        return null
      }
    }),
  )

  return ideas.filter((idea): idea is Idea => idea !== null)
}

/**
 * Write a single idea to the ideas directory as `{idea.id}.json`.
 * Creates the directory if it doesn't exist.
 * Updates the `updatedAt` timestamp.
 */
export async function writeIdea(idea: Idea, dir?: string): Promise<void> {
  const ideasDir = resolveIdeasDir(dir)
  const ideaPath = getIdeaFilePath(idea.id, ideasDir)
  const now = new Date().toISOString()

  if (!isValidIsoDateString(idea.publishBy)) {
    throw new Error(`Invalid publishBy date: ${idea.publishBy}`)
  }

  idea.updatedAt = now

  await ensureDirectory(ideasDir)
  await writeJsonFile(ideaPath, idea)
}

/**
 * Read a single idea by ID.
 * Returns null if the idea file doesn't exist.
 */
export async function readIdea(id: string, dir?: string): Promise<Idea | null> {
  const ideaPath = getIdeaFilePath(id, dir)

  if (!(await fileExists(ideaPath))) {
    return null
  }

  const idea = await readJsonFile<unknown>(ideaPath)
  if (!isIdea(idea)) {
    throw new Error(`File does not contain a valid idea: ${ideaPath}`)
  }

  return idea
}

/**
 * List all idea IDs in the directory (without reading file contents).
 * Returns empty array if directory doesn't exist.
 */
export async function listIdeaIds(dir?: string): Promise<string[]> {
  const ideasDir = resolveIdeasDir(dir)

  if (!(await fileExists(ideasDir))) {
    return []
  }

  const entries = await listDirectory(ideasDir)
  return entries
    .filter((entry) => entry.toLowerCase().endsWith(IDEA_FILE_EXTENSION))
    .map((entry) => entry.slice(0, -IDEA_FILE_EXTENSION.length))
}

/**
 * Delete an idea file by ID.
 * No-op if the file doesn't exist.
 */
export async function deleteIdea(id: string, dir?: string): Promise<void> {
  const ideaPath = getIdeaFilePath(id, dir)

  try {
    await removeFile(ideaPath)
  } catch (error: unknown) {
    logger.error(`Failed to delete idea ${id}: ${getErrorMessage(error)}`)
    throw new Error(`Failed to delete idea ${id}: ${getErrorMessage(error)}`)
  }
}
