import { OpenAI } from '../../core/ai.js'
import { fileExistsSync, getFileStatsSync, openReadStream } from '../../core/fileSystem.js'
import { getConfig } from '../../config/environment'
import logger from '../../config/logger'
import { getWhisperPrompt } from '../../config/brand'
import { Transcript, Segment, Word } from '../../types'
import { costTracker } from '../../services/costTracker.js'

const MAX_FILE_SIZE_MB = 25
const WHISPER_COST_PER_MINUTE = 0.006  // $0.006/minute for whisper-1
const WARN_FILE_SIZE_MB = 20
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 5000

export async function transcribeAudio(audioPath: string): Promise<Transcript> {
  logger.info(`Starting Whisper transcription: ${audioPath}`)

  if (!fileExistsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`)
  }

  // Check file size against Whisper's 25MB limit
  const stats = getFileStatsSync(audioPath)
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

    let response: Awaited<ReturnType<typeof openai.audio.transcriptions.create>> | undefined
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        response = await openai.audio.transcriptions.create({
          model: 'whisper-1',
          file: openReadStream(audioPath),
          response_format: 'verbose_json',
          timestamp_granularities: ['word', 'segment'],
          ...(prompt && { prompt }),
        })
        break
      } catch (retryError: unknown) {
        // Safely extract status - network errors may not have this property
        const status = typeof retryError === 'object' && retryError !== null && 'status' in retryError
          ? (retryError as { status?: number }).status
          : undefined
        if (status === 401 || status === 400 || status === 429) throw retryError
        if (attempt === MAX_RETRIES) throw retryError
        const msg = retryError instanceof Error ? retryError.message : String(retryError)
        logger.warn(`Whisper attempt ${attempt}/${MAX_RETRIES} failed: ${msg} — retrying in ${RETRY_DELAY_MS / 1000}s`)
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
      }
    }

    if (!response) throw new Error('Whisper transcription failed after all retries')

    // The verbose_json response includes segments and words at the top level,
    // but the OpenAI SDK types don't expose them — cast to access raw fields.
    const verboseResponse = response as unknown as Record<string, unknown>
    const rawSegments = (verboseResponse.segments ?? []) as Array<{
      id: number; text: string; start: number; end: number
    }>
    const rawWords = (verboseResponse.words ?? []) as Array<{
      word: string; start: number; end: number
    }>

    // Cast to access typed fields — the verbose_json format always returns an object, not a string
    const typedResponse = response as unknown as { text: string; language?: string; duration?: number }

    const words: Word[] = rawWords.map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    }))

    const segments: Segment[] = rawSegments.map((s) => ({
      id: s.id,
      text: s.text.trim(),
      start: s.start,
      end: s.end,
      words: rawWords
        .filter((w) => w.start >= s.start && w.end <= s.end)
        .map((w) => ({ word: w.word, start: w.start, end: w.end })),
    }))

    logger.info(
      `Transcription complete — ${segments.length} segments, ` +
      `${words.length} words, language=${typedResponse.language}`
    )

    // Track Whisper API cost
    const durationMinutes = (typedResponse.duration ?? 0) / 60
    costTracker.recordServiceUsage('whisper', durationMinutes * WHISPER_COST_PER_MINUTE, {
      model: 'whisper-1',
      durationSeconds: typedResponse.duration ?? 0,
      audioFile: audioPath,
    })

    return {
      text: typedResponse.text,
      segments,
      words,
      language: typedResponse.language ?? 'unknown',
      duration: typedResponse.duration ?? 0,
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Whisper transcription failed: ${message}`)

    // OpenAI SDK errors expose a `status` property for HTTP status codes
    const status = (error as { status?: number }).status
    if (status === 401) {
      throw new Error('OpenAI API authentication failed. Check your OPENAI_API_KEY.')
    }
    if (status === 429) {
      throw new Error('OpenAI API rate limit exceeded. Please try again later.')
    }
    throw new Error(`Whisper transcription failed: ${message}`)
  }
}
