import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QueueItemMetadata } from '../../L3-services/postStore/postStore.js'

let tempDir = ''
let originalCwd = ''
let originalOutputDir: string | undefined
let originalRepoRoot: string | undefined

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
    ideaIds: [],
  }
}

describe('postStore e2e', () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'poststore-e2e-'))
    originalCwd = process.cwd()
    originalOutputDir = process.env.OUTPUT_DIR
    originalRepoRoot = process.env.REPO_ROOT

    await mkdir(join(tempDir, 'publish-queue'), { recursive: true })

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

  test('approveItem normalizes twitter platform to x in queue metadata', async () => {
    const { createItem, approveItem, getPublishedItems } = await import('../../L3-services/postStore/postStore.js')

    await createItem('twitter-normalization', buildQueueItemMetadata(), 'Normalize this post')

    await approveItem('twitter-normalization', {
      latePostId: 'late-post-123',
      scheduledFor: '2026-02-02T12:00:00.000Z',
    })

    // After approve, item moves from publish-queue/ to published/
    const published = await getPublishedItems()
    const approved = published.find(item => item.id === 'twitter-normalization')
    expect(approved).toBeDefined()
    expect(approved!.metadata.status).toBe('published')
    expect(approved!.metadata.latePostId).toBe('late-post-123')
  })
})
