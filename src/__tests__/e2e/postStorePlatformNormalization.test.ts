import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Platform } from '../../L0-pure/types/index.js'
import type { Idea } from '../../L0-pure/types/index.js'
import type { QueueItemMetadata } from '../../L3-services/postStore/postStore.js'

let tempDir = ''
let originalCwd = ''
let originalOutputDir: string | undefined
let originalRepoRoot: string | undefined

function buildIdea(): Idea {
  return {
    id: 'the-idea-id',
    topic: 'Platform normalization regression',
    hook: 'twitter queue items should write x to ideas',
    audience: 'Developers maintaining publish workflows',
    keyTakeaway: 'Idea publish records should use normalized platform names.',
    talkingPoints: ['Approve queue item', 'Persist idea publish record'],
    platforms: [Platform.X],
    status: 'recorded',
    tags: ['poststore', 'regression'],
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    publishBy: '2026-12-31T00:00:00.000Z',
    sourceVideoSlug: 'the-video',
  }
}

function buildQueueItemMetadata(): QueueItemMetadata {
  return {
    id: 'twitter-normalization',
    platform: 'twitter',
    accountId: 'account-1',
    sourceVideo: 'the-video',
    sourceClip: null,
    clipType: 'video',
    sourceMediaPath: null,
    hashtags: [],
    links: [],
    characterCount: 42,
    platformCharLimit: 280,
    suggestedSlot: null,
    scheduledFor: null,
    status: 'pending_review',
    latePostId: null,
    publishedUrl: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    reviewedAt: null,
    publishedAt: null,
    ideaIds: ['the-idea-id'],
  }
}

describe('postStore e2e', () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'poststore-e2e-'))
    originalCwd = process.cwd()
    originalOutputDir = process.env.OUTPUT_DIR
    originalRepoRoot = process.env.REPO_ROOT

    await mkdir(join(tempDir, 'publish-queue'), { recursive: true })
    await mkdir(join(tempDir, 'ideas'), { recursive: true })

    process.chdir(tempDir)
    process.env.OUTPUT_DIR = tempDir
    process.env.REPO_ROOT = tempDir

    const { initConfig } = await import('../../L1-infra/config/environment.js')
    initConfig({ outputDir: tempDir })
  })

  afterAll(async () => {
    process.chdir(originalCwd)

    if (originalOutputDir === undefined) {
      delete process.env.OUTPUT_DIR
    } else {
      process.env.OUTPUT_DIR = originalOutputDir
    }

    if (originalRepoRoot === undefined) {
      delete process.env.REPO_ROOT
    } else {
      process.env.REPO_ROOT = originalRepoRoot
    }

    const { initConfig } = await import('../../L1-infra/config/environment.js')
    if (originalOutputDir !== undefined) {
      initConfig({ outputDir: originalOutputDir })
    } else {
      initConfig()
    }

    await rm(tempDir, { recursive: true, force: true })
  })

  test('approveItem writes x to idea publish records for twitter queue items', async () => {
    const { createItem, approveItem } = await import('../../L3-services/postStore/postStore.js')

    const ideaPath = join(tempDir, 'ideas', 'the-idea-id.json')
    await writeFile(ideaPath, JSON.stringify(buildIdea(), null, 2), 'utf-8')

    await createItem('twitter-normalization', buildQueueItemMetadata(), 'Normalize this post')

    await approveItem('twitter-normalization', {
      latePostId: 'late-post-123',
      scheduledFor: '2026-02-02T12:00:00.000Z',
    })

    const updatedIdea = JSON.parse(await readFile(ideaPath, 'utf-8')) as Idea

    expect(updatedIdea.publishedContent).toHaveLength(1)
    expect(updatedIdea.publishedContent?.[0]?.platform).toBe('x')
    expect(updatedIdea.publishedContent?.[0]?.platform).not.toBe('twitter')
  })
})
