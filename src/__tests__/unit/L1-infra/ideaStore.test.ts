import { describe, it, expect, afterEach } from 'vitest'
import { promises as fsp } from 'fs'
import os from 'os'
import { join } from 'path'
import { readIdea, writeIdea } from '../../../L1-infra/ideaStore/ideaStore.js'
import type { Idea } from '../../../L0-pure/types/index.js'
import { Platform } from '../../../L0-pure/types/index.js'

let tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'vidpipe-ideastore-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const d of tempDirs) {
    await fsp.rm(d, { recursive: true, force: true }).catch(() => {})
  }
  tempDirs = []
})

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 'test-idea',
    issueNumber: 1,
    issueUrl: 'https://github.com/test/repo/issues/1',
    repoFullName: 'test/repo',
    topic: 'Test Topic',
    hook: 'Test hook',
    audience: 'Developers',
    keyTakeaway: 'Test takeaway',
    talkingPoints: ['Point 1'],
    platforms: [Platform.YouTube],
    status: 'draft',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishBy: '2026-02-01',
    ...overrides,
  }
}

describe('ideaStore legacy clipType normalization', () => {
  it('normalizes medium-clip to medium in publishedContent when reading an idea', async () => {
    const dir = await makeTempDir()
    const idea = makeIdea({
      id: 'legacy-idea',
      status: 'published',
      publishedContent: [
        {
          clipType: 'medium-clip' as 'medium',  // simulate legacy file on disk
          platform: Platform.LinkedIn,
          queueItemId: 'my-clip-linkedin',
          publishedAt: '2026-01-15T10:00:00.000Z',
          latePostId: 'late-123',
          lateUrl: 'https://getlate.dev/post/late-123',
        },
      ],
    })

    // Write the idea using the raw JSON so we can force the legacy value
    await fsp.writeFile(
      join(dir, 'legacy-idea.json'),
      JSON.stringify({ ...idea, publishedContent: [{ ...idea.publishedContent![0], clipType: 'medium-clip' }] }),
    )

    const read = await readIdea('legacy-idea', dir)
    expect(read).not.toBeNull()
    expect(read!.publishedContent![0].clipType).toBe('medium')
  })

  it('does not change clipType medium when reading an idea', async () => {
    const dir = await makeTempDir()
    const idea = makeIdea({
      id: 'new-idea',
      status: 'published',
      publishedContent: [
        {
          clipType: 'medium',
          platform: Platform.LinkedIn,
          queueItemId: 'my-clip-linkedin',
          publishedAt: '2026-01-15T10:00:00.000Z',
          latePostId: 'late-456',
          lateUrl: 'https://getlate.dev/post/late-456',
        },
      ],
    })

    await writeIdea(idea, dir)

    const read = await readIdea('new-idea', dir)
    expect(read).not.toBeNull()
    expect(read!.publishedContent![0].clipType).toBe('medium')
  })
})
