import OpenAI from 'openai'
import fs from 'fs'
import { getConfig } from '../../config/environment'
import logger from '../../config/logger'
import { getWhisperPrompt } from '../../config/brand'
import { Transcript, Segment, Word } from '../../types'

const MAX_FILE_SIZE_MB = 25
const WARN_FILE_SIZE_MB = 20

export async function transcribeAudio(audioPath: string): Promise<Transcript> {
  logger.info(`Starting Whisper transcription: ${audioPath}`)

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`)
  }

  // Check file size against Whisper's 25MB limit
  const stats = fs.statSync(audioPath)
  const fileSizeMB = stats.size / (1024 * 1024)

  if (fileSizeMB > MAX_FILE_SIZE_MB) {
    throw new Error(
      `Audio file exceeds Whisper's 25MB limit (${fileSizeMB.toFixed(1)}MB). ` +
      'The file should be split into smaller chunks before transcription.'
    )
  }
  if (fileSizeMB > WARN_FILE_SIZE_MB) {
    logger.warn(`Audio file is ${fileSizeMB.toFixed(1)}MB — approaching 25MB limit`)
  }

  const config = getConfig()
  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY })

  try {
    const prompt = getWhisperPrompt()
    const response = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(audioPath),
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
      ...(prompt && { prompt }),
    })

    // The verbose_json response includes segments and words at the top level
    const rawSegments: any[] = (response as any).segments ?? []
    const rawWords: any[] = (response as any).words ?? []

    const words: Word[] = rawWords.map((w: any) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    }))

    const segments: Segment[] = rawSegments.map((s: any) => ({
      id: s.id,
      text: s.text.trim(),
      start: s.start,
      end: s.end,
      words: rawWords
        .filter((w: any) => w.start >= s.start && w.end <= s.end)
        .map((w: any) => ({ word: w.word, start: w.start, end: w.end })),
    }))

    logger.info(
      `Transcription complete — ${segments.length} segments, ` +
      `${words.length} words, language=${response.language}`
    )

    return {
      text: response.text,
      segments,
      words,
      language: response.language ?? 'unknown',
      duration: response.duration ?? 0,
    }
  } catch (error: any) {
    logger.error(`Whisper transcription failed: ${error.message}`)

    if (error.status === 401) {
      throw new Error('OpenAI API authentication failed. Check your OPENAI_API_KEY.')
    }
    if (error.status === 429) {
      throw new Error('OpenAI API rate limit exceeded. Please try again later.')
    }
    throw new Error(`Whisper transcription failed: ${error.message}`)
  }
}
