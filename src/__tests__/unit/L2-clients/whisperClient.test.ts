import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fileSystem
vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExistsSync: vi.fn().mockReturnValue(true),
  readTextFileSync: vi.fn(),
  getFileStatsSync: vi.fn().mockReturnValue({ size: 1024 * 1024 }),
  openReadStream: vi.fn().mockReturnValue('fake-stream'),
}))

// Mock environment config
vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    OPENAI_API_KEY: 'test-key',
    BRAND_PATH: '/fake/brand.json',
    EXA_API_KEY: '',
  }),
  initConfig: vi.fn(),
}))

// Mock brand config
vi.mock('../../../L1-infra/config/brand.js', () => ({
  getWhisperPrompt: vi.fn().mockReturnValue(''),
  getBrandConfig: vi.fn().mockReturnValue({ name: 'Test', handle: '@test' }),
}))

// Mock OpenAI
const mockCreate = vi.fn().mockResolvedValue({
  text: 'Hello world',
  language: 'en',
  duration: 5.0,
  segments: [{ id: 0, start: 0, end: 1, text: 'Hello world' }],
  words: [
    { word: 'Hello', start: 0, end: 0.5 },
    { word: 'world', start: 0.6, end: 1.0 },
  ],
})

vi.mock('../../../L2-clients/llm/ai.js', () => ({
  OpenAI: class MockOpenAI {
    audio = {
      transcriptions: {
        create: mockCreate,
      },
    }
  },
}))

import { fileExistsSync, getFileStatsSync } from '../../../L1-infra/fileSystem/fileSystem.js'
import { getConfig } from '../../../L1-infra/config/environment.js'
import { transcribeAudio } from '../../../L2-clients/whisper/whisperClient.js'

describe('whisperClient.ts', () => {
  beforeEach(() => {
    mockCreate.mockClear()
    vi.mocked(fileExistsSync).mockReturnValue(true)
    vi.mocked(getFileStatsSync).mockReturnValue({ size: 1024 * 1024 } as any)
    vi.mocked(getConfig).mockReturnValue({
      OPENAI_API_KEY: 'test-key',
      BRAND_PATH: '/fake/brand.json',
      EXA_API_KEY: '',
    } as any)
  })

  it('transcribeAudio() returns correct transcript structure', async () => {
    const result = await transcribeAudio('/fake/audio.mp3')

    expect(result.text).toBe('Hello world')
    expect(result.language).toBe('en')
    expect(result.duration).toBe(5.0)
    expect(result.segments).toHaveLength(1)
    expect(result.words).toHaveLength(2)
  })

  it('transcribeAudio() parses words correctly', async () => {
    const result = await transcribeAudio('/fake/audio.mp3')

    expect(result.words[0]).toEqual({ word: 'Hello', start: 0, end: 0.5 })
    expect(result.words[1]).toEqual({ word: 'world', start: 0.6, end: 1.0 })
  })

  it('transcribeAudio() throws when file not found', async () => {
    vi.mocked(fileExistsSync).mockReturnValue(false)

    await expect(transcribeAudio('/missing/audio.mp3')).rejects.toThrow(
      'Audio file not found'
    )
  })

  it('transcribeAudio() throws when file exceeds 25MB', async () => {
    vi.mocked(getFileStatsSync).mockReturnValue({
      size: 30 * 1024 * 1024,
    } as any)

    await expect(transcribeAudio('/fake/large.mp3')).rejects.toThrow(
      "exceeds Whisper's 25MB limit"
    )
  })

  it('transcribeAudio() handles API 401 error', async () => {
    mockCreate.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { status: 401 })
    )

    await expect(transcribeAudio('/fake/audio.mp3')).rejects.toThrow(
      'OpenAI API authentication failed'
    )
  })

  it('transcribeAudio() handles API 429 rate limit', async () => {
    mockCreate.mockRejectedValueOnce(
      Object.assign(new Error('Rate limited'), { status: 429 })
    )

    await expect(transcribeAudio('/fake/audio.mp3')).rejects.toThrow(
      'rate limit exceeded'
    )
  })
})
