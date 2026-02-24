import { vi, describe, test, expect, afterEach } from 'vitest'

const mockFfprobe = vi.hoisted(() => vi.fn())
const mockGetFFmpegPath = vi.hoisted(() => vi.fn())
const mockGetFFprobePath = vi.hoisted(() => vi.fn())
const mockExtractAudio = vi.hoisted(() => vi.fn())
const mockSplitAudioIntoChunks = vi.hoisted(() => vi.fn())
const mockExtractClip = vi.hoisted(() => vi.fn())
const mockExtractCompositeClip = vi.hoisted(() => vi.fn())
const mockExtractCompositeClipWithTransitions = vi.hoisted(() => vi.fn())
const mockSinglePassEdit = vi.hoisted(() => vi.fn())
const mockSinglePassEditAndCaption = vi.hoisted(() => vi.fn())
const mockBurnCaptions = vi.hoisted(() => vi.fn())
const mockDetectSilence = vi.hoisted(() => vi.fn())
const mockCaptureFrame = vi.hoisted(() => vi.fn())
const mockGeneratePlatformVariants = vi.hoisted(() => vi.fn())
const mockDetectWebcamRegion = vi.hoisted(() => vi.fn())
const mockGetVideoResolution = vi.hoisted(() => vi.fn())
const mockCompositeOverlays = vi.hoisted(() => vi.fn())
const mockBuildOverlayFilterComplex = vi.hoisted(() => vi.fn())
const mockGetOverlayPosition = vi.hoisted(() => vi.fn())

vi.mock('../../../../L2-clients/ffmpeg/ffmpeg.js', () => ({
  ffprobe: mockFfprobe,
  getFFmpegPath: mockGetFFmpegPath,
  getFFprobePath: mockGetFFprobePath,
}))
vi.mock('../../../../L2-clients/ffmpeg/audioExtraction.js', () => ({
  extractAudio: mockExtractAudio,
  splitAudioIntoChunks: mockSplitAudioIntoChunks,
}))
vi.mock('../../../../L2-clients/ffmpeg/clipExtraction.js', () => ({
  extractClip: mockExtractClip,
  extractCompositeClip: mockExtractCompositeClip,
  extractCompositeClipWithTransitions: mockExtractCompositeClipWithTransitions,
}))
vi.mock('../../../../L2-clients/ffmpeg/singlePassEdit.js', () => ({
  singlePassEdit: mockSinglePassEdit,
  singlePassEditAndCaption: mockSinglePassEditAndCaption,
}))
vi.mock('../../../../L2-clients/ffmpeg/captionBurning.js', () => ({
  burnCaptions: mockBurnCaptions,
}))
vi.mock('../../../../L2-clients/ffmpeg/silenceDetection.js', () => ({
  detectSilence: mockDetectSilence,
}))
vi.mock('../../../../L2-clients/ffmpeg/frameCapture.js', () => ({
  captureFrame: mockCaptureFrame,
}))
vi.mock('../../../../L2-clients/ffmpeg/aspectRatio.js', () => ({
  generatePlatformVariants: mockGeneratePlatformVariants,
}))
vi.mock('../../../../L2-clients/ffmpeg/faceDetection.js', () => ({
  detectWebcamRegion: mockDetectWebcamRegion,
  getVideoResolution: mockGetVideoResolution,
}))
vi.mock('../../../../L2-clients/ffmpeg/overlayCompositing.js', () => ({
  compositeOverlays: mockCompositeOverlays,
  buildOverlayFilterComplex: mockBuildOverlayFilterComplex,
  getOverlayPosition: mockGetOverlayPosition,
}))

import {
  ffprobe, getFFmpegPath, getFFprobePath,
  extractAudio, splitAudioIntoChunks,
  extractClip, extractCompositeClip, extractCompositeClipWithTransitions,
  singlePassEdit, singlePassEditAndCaption,
  burnCaptions, detectSilence, captureFrame,
  generatePlatformVariants, detectWebcamRegion, getVideoResolution,
  compositeOverlays, buildOverlayFilterComplex, getOverlayPosition,
} from '../../../../L3-services/videoOperations/videoOperations.js'

describe('L3 videoOperations wrappers', () => {
  afterEach(() => vi.clearAllMocks())

  test('ffprobe delegates to L2', async () => {
    mockFfprobe.mockResolvedValue({ format: {} })
    const result = await ffprobe('/tmp/v.mp4')
    expect(result).toEqual({ format: {} })
    expect(mockFfprobe).toHaveBeenCalledWith('/tmp/v.mp4')
  })

  test('getFFmpegPath delegates to L2', () => {
    mockGetFFmpegPath.mockReturnValue('/usr/bin/ffmpeg')
    expect(getFFmpegPath()).toBe('/usr/bin/ffmpeg')
  })

  test('getFFprobePath delegates to L2', () => {
    mockGetFFprobePath.mockReturnValue('/usr/bin/ffprobe')
    expect(getFFprobePath()).toBe('/usr/bin/ffprobe')
  })

  test('extractAudio delegates to L2', async () => {
    mockExtractAudio.mockResolvedValue('/tmp/audio.mp3')
    const result = await extractAudio('/tmp/v.mp4', '/tmp/audio.mp3')
    expect(result).toBe('/tmp/audio.mp3')
    expect(mockExtractAudio).toHaveBeenCalledWith('/tmp/v.mp4', '/tmp/audio.mp3')
  })

  test('splitAudioIntoChunks delegates to L2', async () => {
    mockSplitAudioIntoChunks.mockResolvedValue(['/tmp/c1.mp3'])
    const result = await splitAudioIntoChunks('/tmp/audio.mp3', 24)
    expect(result).toEqual(['/tmp/c1.mp3'])
  })

  test('extractClip delegates to L2', async () => {
    mockExtractClip.mockResolvedValue('/tmp/clip.mp4')
    const result = await extractClip('/tmp/v.mp4', 10, 20, '/tmp/clip.mp4')
    expect(result).toBe('/tmp/clip.mp4')
  })

  test('extractCompositeClip delegates to L2', async () => {
    mockExtractCompositeClip.mockResolvedValue('/tmp/comp.mp4')
    const result = await extractCompositeClip('/tmp/v.mp4', [], '/tmp/comp.mp4')
    expect(result).toBe('/tmp/comp.mp4')
  })

  test('extractCompositeClipWithTransitions delegates to L2', async () => {
    mockExtractCompositeClipWithTransitions.mockResolvedValue('/tmp/tr.mp4')
    const result = await extractCompositeClipWithTransitions('/tmp/v.mp4', [], '/tmp/tr.mp4')
    expect(result).toBe('/tmp/tr.mp4')
  })

  test('singlePassEdit delegates to L2', async () => {
    mockSinglePassEdit.mockResolvedValue('/tmp/edited.mp4')
    const result = await singlePassEdit('/tmp/v.mp4', [], '/tmp/edited.mp4')
    expect(result).toBe('/tmp/edited.mp4')
  })

  test('singlePassEditAndCaption delegates to L2', async () => {
    mockSinglePassEditAndCaption.mockResolvedValue('/tmp/cap.mp4')
    const result = await singlePassEditAndCaption('/tmp/v.mp4', [], '/tmp/s.ass', '/tmp/cap.mp4')
    expect(result).toBe('/tmp/cap.mp4')
  })

  test('burnCaptions delegates to L2', async () => {
    mockBurnCaptions.mockResolvedValue('/tmp/burned.mp4')
    const result = await burnCaptions('/tmp/v.mp4', '/tmp/s.ass', '/tmp/burned.mp4')
    expect(result).toBe('/tmp/burned.mp4')
  })

  test('detectSilence delegates to L2', async () => {
    mockDetectSilence.mockResolvedValue([{ start: 0, end: 1, duration: 1 }])
    const result = await detectSilence('/tmp/audio.mp3')
    expect(result).toHaveLength(1)
  })

  test('captureFrame delegates to L2', async () => {
    mockCaptureFrame.mockResolvedValue('/tmp/frame.png')
    const result = await captureFrame('/tmp/v.mp4', 5.0, '/tmp/frame.png')
    expect(result).toBe('/tmp/frame.png')
  })

  test('generatePlatformVariants delegates to L2', async () => {
    mockGeneratePlatformVariants.mockResolvedValue([])
    const result = await generatePlatformVariants('/tmp/v.mp4', '/tmp/out', 'slug')
    expect(result).toEqual([])
  })

  test('detectWebcamRegion delegates to L2', async () => {
    mockDetectWebcamRegion.mockResolvedValue(null)
    const result = await detectWebcamRegion('/tmp/v.mp4')
    expect(result).toBeNull()
  })

  test('getVideoResolution delegates to L2', async () => {
    mockGetVideoResolution.mockResolvedValue({ width: 1920, height: 1080 })
    const result = await getVideoResolution('/tmp/v.mp4')
    expect(result).toEqual({ width: 1920, height: 1080 })
  })

  test('compositeOverlays delegates to L2', async () => {
    mockCompositeOverlays.mockResolvedValue('/tmp/overlay.mp4')
    const result = await compositeOverlays('/tmp/v.mp4', [], '/tmp/overlay.mp4', 1920, 1080)
    expect(result).toBe('/tmp/overlay.mp4')
  })

  test('buildOverlayFilterComplex delegates to L2', () => {
    mockBuildOverlayFilterComplex.mockReturnValue('[0:v]overlay')
    const result = buildOverlayFilterComplex([], 1920, 1080)
    expect(result).toBe('[0:v]overlay')
  })

  test('getOverlayPosition delegates to L2', () => {
    mockGetOverlayPosition.mockReturnValue({ x: '10', y: '10' })
    const result = getOverlayPosition({ position: 'top-left' } as never, 10)
    expect(result).toEqual({ x: '10', y: '10' })
  })
})
