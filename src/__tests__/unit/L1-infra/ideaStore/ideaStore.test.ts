import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { Platform, type Idea } from '../../../../L0-pure/types/index.js'
import { deleteIdea, listIdeaIds, readIdea, readIdeaBank, writeIdea } from '../../../../L1-infra/ideaStore/ideaStore.js'

let tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(os.tmpdir(), 'vidpipe-idea-store-'))
  tempDirs.push(dir)
  return dir
}

function createIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: overrides.id ?? 'idea-copilot-debugging',
    topic: overrides.topic ?? 'Copilot debugging workflows',
    hook: overrides.hook ?? 'Three debugging habits that save me time',
    audience: overrides.audience ?? 'Developers shipping AI-assisted tools',
    keyTakeaway: overrides.keyTakeaway ?? 'Use a repeatable debugging loop with artifacts and notes.',
    talkingPoints: overrides.talkingPoints ?? ['Start with the failing signal', 'Capture artifacts', 'Verify the fix'],
    platforms: overrides.platforms ?? [Platform.YouTube, Platform.LinkedIn],
    status: overrides.status ?? 'draft',
    tags: overrides.tags ?? ['copilot', 'debugging'],
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    publishBy: overrides.publishBy ?? '2026-04-01',
    sourceVideoSlug: overrides.sourceVideoSlug,
    trendContext: overrides.trendContext,
    publishedContent: overrides.publishedContent,
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

describe('ideaStore', () => {
  describe('REQ-001: readIdeaBank returns an empty array when the ideas directory is missing', () => {
    it('ideaStore.REQ-001 - returns an empty array for a missing ideas directory', async () => {
      const dir = join(await makeTempDir(), 'ideas')

      await expect(readIdeaBank(dir)).resolves.toEqual([])
    })
  })

  describe('REQ-002: readIdeaBank loads idea files and skips invalid JSON or non-idea payloads', () => {
    it('ideaStore.REQ-002 - returns only valid ideas from the directory', async () => {
      const dir = await makeTempDir()
      const validIdea = createIdea()

      await writeIdea(validIdea, dir)
      await writeFile(join(dir, 'broken.json'), '{ not valid json', 'utf-8')
      await writeFile(join(dir, 'notes.json'), JSON.stringify({ note: 'not an idea' }, null, 2), 'utf-8')
      await writeFile(join(dir, 'readme.txt'), 'ignore me', 'utf-8')

      const ideas = await readIdeaBank(dir)

      expect(ideas).toHaveLength(1)
      expect(ideas[0]).toMatchObject({ id: validIdea.id, topic: validIdea.topic })
    })
  })

  describe('REQ-003 and REQ-004: writeIdea creates the directory, persists the idea, and refreshes updatedAt', () => {
    it('ideaStore.REQ-003 - writes the idea to {id}.json and updates updatedAt', async () => {
      const dir = join(await makeTempDir(), 'nested', 'ideas')
      const idea = createIdea({ updatedAt: '2024-01-01T00:00:00.000Z' })

      await writeIdea(idea, dir)

      const persisted = JSON.parse(await readFile(join(dir, `${idea.id}.json`), 'utf-8')) as Idea
      expect(persisted.id).toBe(idea.id)
      expect(persisted.publishBy).toBe(idea.publishBy)
      expect(persisted.updatedAt).not.toBe('2024-01-01T00:00:00.000Z')
      expect(idea.updatedAt).toBe(persisted.updatedAt)
    })
  })

  describe('REQ-008: writeIdea rejects invalid publishBy dates', () => {
    it('ideaStore.REQ-008 - throws when publishBy is not a valid ISO 8601 date', async () => {
      const dir = await makeTempDir()
      const idea = createIdea({ publishBy: 'not-a-date' })

      await expect(writeIdea(idea, dir)).rejects.toThrow('Invalid publishBy date: not-a-date')
    })
  })

  describe('REQ-009: readIdea and readIdeaBank validate publishBy on persisted payloads', () => {
    it('ideaStore.REQ-009 - rejects persisted ideas with invalid publishBy', async () => {
      const dir = await makeTempDir()
      const invalidIdea = createIdea({ id: 'idea-invalid-publish-by', publishBy: 'invalid-date' })

      await writeFile(join(dir, `${invalidIdea.id}.json`), JSON.stringify(invalidIdea, null, 2), 'utf-8')

      await expect(readIdea(invalidIdea.id, dir)).rejects.toThrow(`File does not contain a valid idea: ${join(dir, `${invalidIdea.id}.json`)}`)
      await expect(readIdeaBank(dir)).resolves.toEqual([])
    })

    it('ideaStore.REQ-009 - accepts persisted ideas with valid publishBy dates', async () => {
      const dir = await makeTempDir()
      const idea = createIdea({ id: 'idea-valid-publish-by', publishBy: '2026-05-15' })

      await writeIdea(idea, dir)

      await expect(readIdea(idea.id, dir)).resolves.toMatchObject({
        id: idea.id,
        publishBy: '2026-05-15',
      })
    })
  })

  describe('REQ-005: readIdea returns null when an idea file does not exist', () => {
    it('ideaStore.REQ-005 - returns null for a missing idea file', async () => {
      const dir = await makeTempDir()

      await expect(readIdea('missing-idea', dir)).resolves.toBeNull()
    })
  })

  describe('REQ-006: listIdeaIds returns json basenames without reading file contents', () => {
    it('ideaStore.REQ-006 - strips .json and ignores non-json files', async () => {
      const dir = await makeTempDir()

      await writeFile(join(dir, 'alpha.json'), '{}', 'utf-8')
      await writeFile(join(dir, 'beta.json'), '{}', 'utf-8')
      await writeFile(join(dir, 'notes.txt'), 'ignore', 'utf-8')

      const ids = await listIdeaIds(dir)

      expect(ids.sort()).toEqual(['alpha', 'beta'])
    })
  })

  describe('REQ-007: deleteIdea removes an idea file and ignores missing files', () => {
    it('ideaStore.REQ-007 - deletes existing ideas and is a no-op for missing files', async () => {
      const dir = await makeTempDir()
      const idea = createIdea({ id: 'idea-delete-me' })

      await writeIdea(idea, dir)
      await deleteIdea(idea.id, dir)
      await deleteIdea('missing-idea', dir)

      await expect(readIdea(idea.id, dir)).resolves.toBeNull()
    })
  })
})
