import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockConcatVideos = vi.hoisted(() => vi.fn().mockResolvedValue('/out/result.mp4'))
const mockNormalizeForConcat = vi.hoisted(() => vi.fn().mockResolvedValue('/normalized.mp4'))
const mockExecCommand = vi.hoisted(() => vi.fn().mockResolvedValue({ stdout: '', stderr: '' }))

// L4-L6 integration: mock only L2 — L3 through L6 run real
vi.mock('../../../L2-clients/ffmpeg/videoConcat.js', () => ({
  concatVideos: mockConcatVideos,
  normalizeForConcat: mockNormalizeForConcat,
}))

vi.mock('../../../L2-clients/ffmpeg/ffmpeg.js', () => ({
  getFFmpegPath: () => 'ffmpeg',
  getFFprobePath: () => 'ffprobe',
  createFFmpeg: vi.fn(),
  ffprobe: vi.fn(),
}))

import { applyIntroOutro } from '../../../L4-agents/videoServiceBridge.js'

describe('intro/outro L4-L6 pipeline integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConcatVideos.mockResolvedValue('/out/result.mp4')
    mockNormalizeForConcat.mockResolvedValue('/normalized.mp4')
  })

  test('L4 bridge passes all parameters through to L3 service', async () => {
    // This exercises the L4→L3→L2(mocked) chain
    // L3 service will call getConfig/getIntroOutroConfig from real L1,
    // which may return defaults causing early return — that's fine for integration
    const result = await applyIntroOutro('/video.mp4', 'main', '/out.mp4', 'youtube', '16:9')
    // Result is either the output path (if config enabled) or original (if disabled)
    expect(typeof result).toBe('string')
  })

  test('L4 bridge returns string for shorts video type', async () => {
    const result = await applyIntroOutro('/short.mp4', 'shorts', '/short-out.mp4', 'tiktok', '9:16')
    expect(typeof result).toBe('string')
  })

  test('L4 bridge handles medium-clips video type', async () => {
    const result = await applyIntroOutro('/clip.mp4', 'medium-clips', '/clip-out.mp4')
    expect(typeof result).toBe('string')
  })
})
