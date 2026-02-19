import { describe, it, expect } from 'vitest'

describe('L3 videoOperations re-exports', () => {
  it('re-exports ffprobe, getFFmpegPath, getFFprobePath', async () => {
    const mod = await import('../../../L3-services/videoOperations/videoOperations.js')
    expect(mod.ffprobe).toBeDefined()
    expect(mod.getFFmpegPath).toBeDefined()
    expect(mod.getFFprobePath).toBeDefined()
  })

  it('re-exports audio extraction functions', async () => {
    const mod = await import('../../../L3-services/videoOperations/videoOperations.js')
    expect(mod.extractAudio).toBeDefined()
    expect(mod.splitAudioIntoChunks).toBeDefined()
  })

  it('re-exports clip extraction functions', async () => {
    const mod = await import('../../../L3-services/videoOperations/videoOperations.js')
    expect(mod.extractClip).toBeDefined()
    expect(mod.extractCompositeClip).toBeDefined()
    expect(mod.extractCompositeClipWithTransitions).toBeDefined()
  })

  it('re-exports editing functions', async () => {
    const mod = await import('../../../L3-services/videoOperations/videoOperations.js')
    expect(mod.singlePassEdit).toBeDefined()
    expect(mod.singlePassEditAndCaption).toBeDefined()
  })

  it('re-exports caption burning', async () => {
    const mod = await import('../../../L3-services/videoOperations/videoOperations.js')
    expect(mod.burnCaptions).toBeDefined()
  })

  it('re-exports detection functions', async () => {
    const mod = await import('../../../L3-services/videoOperations/videoOperations.js')
    expect(mod.detectSilence).toBeDefined()
  })

  it('re-exports frame capture', async () => {
    const mod = await import('../../../L3-services/videoOperations/videoOperations.js')
    expect(mod.captureFrame).toBeDefined()
  })

  it('re-exports platform variants and face detection', async () => {
    const mod = await import('../../../L3-services/videoOperations/videoOperations.js')
    expect(mod.generatePlatformVariants).toBeDefined()
    expect(mod.detectWebcamRegion).toBeDefined()
    expect(mod.getVideoResolution).toBeDefined()
  })

  it('re-exports overlay compositing', async () => {
    const mod = await import('../../../L3-services/videoOperations/videoOperations.js')
    expect(mod.compositeOverlays).toBeDefined()
    expect(mod.buildOverlayFilterComplex).toBeDefined()
    expect(mod.getOverlayPosition).toBeDefined()
  })
})
