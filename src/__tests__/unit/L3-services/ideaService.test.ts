import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Platform, type Idea } from '../../../L0-pure/types/index.js'
import { readIdeaBank, writeIdea } from '../../../L1-infra/ideaStore/ideaStore.js'
import { getIdeasByIds, markRecorded } from '../../../L3-services/ideation/ideaService.js'

function createIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: overrides.id ?? 'idea-1',
    topic: overrides.topic ?? 'First idea',
    hook: overrides.hook ?? 'Open with the useful outcome',
    audience: overrides.audience ?? 'Developers learning from build videos',
    keyTakeaway: overrides.keyTakeaway ?? 'Lead with value, then explain the process.',
    talkingPoints: overrides.talkingPoints ?? ['State the payoff', 'Walk through the implementation'],
    platforms: overrides.platforms ?? [Platform.YouTube],
    status: overrides.status ?? 'draft',
    tags: overrides.tags ?? ['education'],
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    publishBy: overrides.publishBy ?? '2026-04-01',
    sourceVideoSlug: overrides.sourceVideoSlug,
    trendContext: overrides.trendContext,
    publishedContent: overrides.publishedContent,
  }
}

describe('ideaService', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vidpipe-idea-service-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns ideas in the requested order', async () => {
    const ideas: Idea[] = [
      createIdea({ id: 'idea-1', topic: 'First idea', status: 'draft' }),
      createIdea({ id: 'idea-2', topic: 'Second idea', status: 'ready' }),
    ]
    await Promise.all(ideas.map(async (idea) => writeIdea(idea, tempDir)))

    await expect(getIdeasByIds(['idea-2', 'idea-1'], tempDir)).resolves.toEqual([ideas[1], ideas[0]])
  })

  it('throws when any requested idea id is missing', async () => {
    await writeIdea(createIdea({ id: 'idea-1', topic: 'First idea', status: 'draft' }), tempDir)

    await expect(getIdeasByIds(['idea-1', 'idea-9'], tempDir)).rejects.toThrow('Idea not found: idea-9')
  })

  it('marks ideas as recorded and stores the video slug on the idea', async () => {
    const idea = createIdea({ id: 'idea-1', topic: 'First idea', status: 'ready' })
    const originalUpdatedAt = idea.updatedAt
    await writeIdea(idea, tempDir)

    await markRecorded('idea-1', 'session-42', tempDir)

    const [recordedIdea] = await readIdeaBank(tempDir)
    expect(recordedIdea).toMatchObject({
      id: 'idea-1',
      topic: 'First idea',
      status: 'recorded',
      sourceVideoSlug: 'session-42',
    })
    expect(recordedIdea.updatedAt).not.toBe(originalUpdatedAt)
  })
})
