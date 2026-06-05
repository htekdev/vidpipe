import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createVideoKnowledgeBase, readVideoKnowledgeBase, writeVideoKnowledgeBase } from '../../../L6-pipeline/knowledgeBase.js'
import type { VideoFile } from '../../../L0-pure/types/index.js'

function makeVideo(overrides: Partial<VideoFile> = {}): VideoFile {
  return {
    originalPath: '/tmp/input.mp4',
    repoPath: '/tmp/repo/input.mp4',
    videoDir: '/tmp/repo',
    slug: 'input',
    filename: 'input.mp4',
    duration: 42,
    size: 1024,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    layout: {
      width: 1920,
      height: 1080,
      webcam: { x: 10, y: 20, width: 320, height: 180, position: 'bottom-right', confidence: 0.95 },
      screen: { x: 0, y: 0, width: 1920, height: 1080 },
    },
    ...overrides,
  }
}

describe('knowledgeBase helpers', () => {
  it('creates an initialized blackboard from video metadata', () => {
    const kb = createVideoKnowledgeBase(makeVideo())
    expect(kb.duration).toBe(42)
    expect(kb.resolution).toEqual({ width: 1920, height: 1080 })
    expect(kb.layout.webcam?.position).toBe('bottom-right')
    expect(kb.audio.silenceRegions).toEqual([])
    expect(kb.scenes.boundaries).toEqual([])
  })

  it('writes and reads knowledge-base.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vidpipe-kb-'))
    try {
      const video = makeVideo({ videoDir: dir })
      const kb = createVideoKnowledgeBase(video)
      kb.transcript = {
        whisper: { text: 'hello', segments: [], words: [], language: 'en', duration: 42 },
        merged: { text: 'hello', segments: [], words: [], language: 'en', duration: 42 },
        confidence: 0.99,
      }

      const output = await writeVideoKnowledgeBase(dir, kb)
      expect(output.endsWith('knowledge-base.json')).toBe(true)

      const loaded = await readVideoKnowledgeBase(dir)
      expect(loaded).toBeDefined()
      expect(loaded?.video.slug).toBe('input')
      expect(loaded?.transcript?.merged.text).toBe('hello')
      expect(loaded?.video.createdAt).toBeInstanceOf(Date)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
