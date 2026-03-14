import { beforeEach, describe, expect, test, vi } from 'vitest'

const {
  mockFfmpegInstance,
  mockFfmpegCtor,
  mockEnsureDirectory,
  mockDirname,
  ffmpegHandlers,
} = vi.hoisted(() => {
  const handlers: Record<string, Function | undefined> = {}
  const inst: Record<string, any> = {
    outputOptions: vi.fn().mockReturnThis(),
    output: vi.fn().mockReturnThis(),
    on: vi.fn(function (this: any, event: string, cb: Function) {
      handlers[event] = cb
      return this
    }),
    run: vi.fn(),
  }

  return {
    mockFfmpegInstance: inst,
    mockFfmpegCtor: vi.fn(() => inst),
    mockEnsureDirectory: vi.fn().mockResolvedValue(undefined),
    mockDirname: vi.fn((filePath: string) => filePath.substring(0, filePath.lastIndexOf('/'))),
    ffmpegHandlers: handlers,
  }
})

vi.mock('../../../L2-clients/ffmpeg/ffmpeg.js', () => ({
  createFFmpeg: mockFfmpegCtor,
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  ensureDirectory: mockEnsureDirectory,
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  dirname: mockDirname,
}))

import { transcodeToMp4 } from '../../../L2-clients/ffmpeg/transcoding.js'

beforeEach(() => {
  vi.clearAllMocks()

  for (const key of Object.keys(ffmpegHandlers)) {
    delete ffmpegHandlers[key]
  }

  mockEnsureDirectory.mockResolvedValue(undefined)
  mockDirname.mockImplementation((filePath: string) => filePath.substring(0, filePath.lastIndexOf('/')))
  mockFfmpegCtor.mockImplementation(() => mockFfmpegInstance)
  mockFfmpegInstance.outputOptions.mockReturnThis()
  mockFfmpegInstance.output.mockReturnThis()
  mockFfmpegInstance.on.mockImplementation(function (this: any, event: string, cb: Function) {
    ffmpegHandlers[event] = cb
    return this
  })
  mockFfmpegInstance.run.mockImplementation(() => {
    setTimeout(() => {
      ffmpegHandlers.end?.()
    }, 0)
  })
})

describe('transcodeToMp4', () => {
  test('calls ensureDirectory for the output directory', async () => {
    const outputPath = '/videos/output/clip.mp4'

    await transcodeToMp4('/videos/input/clip.webm', outputPath)

    expect(mockDirname).toHaveBeenCalledWith(outputPath)
    expect(mockEnsureDirectory).toHaveBeenCalledWith('/videos/output')
  })

  test('calls createFFmpeg with the input path', async () => {
    const inputPath = '/videos/input/clip.webm'

    await transcodeToMp4(inputPath, '/videos/output/clip.mp4')

    expect(mockFfmpegCtor).toHaveBeenCalledWith(inputPath)
  })

  test('passes the correct codec options to ffmpeg', async () => {
    await transcodeToMp4('/videos/input/clip.webm', '/videos/output/clip.mp4')

    expect(mockFfmpegInstance.outputOptions).toHaveBeenCalledWith([
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-threads', '4',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
    ])
    expect(mockFfmpegInstance.output).toHaveBeenCalledWith('/videos/output/clip.mp4')
  })

  test('resolves with the output path on ffmpeg end', async () => {
    const outputPath = '/videos/output/clip.mp4'

    await expect(transcodeToMp4('/videos/input/clip.webm', outputPath)).resolves.toBe(outputPath)
    expect(mockFfmpegInstance.run).toHaveBeenCalledOnce()
  })

  test('rejects with a descriptive error on ffmpeg error', async () => {
    const ffmpegError = new Error('encoder crashed')
    mockFfmpegInstance.run.mockImplementation(() => {
      setTimeout(() => {
        const errorHandler = ffmpegHandlers.error as ((err: Error) => void) | undefined
        errorHandler?.(ffmpegError)
      }, 0)
    })

    await expect(transcodeToMp4('/videos/input/clip.webm', '/videos/output/clip.mp4')).rejects.toThrow(
      'Transcoding to MP4 failed: encoder crashed',
    )
  })

  test('rejects if ensureDirectory fails', async () => {
    const ensureError = new Error('cannot create output directory')
    mockEnsureDirectory.mockRejectedValueOnce(ensureError)

    await expect(transcodeToMp4('/videos/input/clip.webm', '/videos/output/clip.mp4')).rejects.toBe(ensureError)
    expect(mockFfmpegCtor).not.toHaveBeenCalled()
  })
})
