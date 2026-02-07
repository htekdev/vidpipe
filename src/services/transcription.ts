import path from 'path'
import fsp from 'fs/promises'
import { extractAudio, splitAudioIntoChunks } from '../tools/ffmpeg/audioExtraction'
import { transcribeAudio } from '../tools/whisper/whisperClient'
import { VideoFile, Transcript, Segment, Word } from '../types'
import { getConfig } from '../config/environment'
import logger from '../config/logger'

const MAX_WHISPER_SIZE_MB = 25

export async function transcribeVideo(video: VideoFile): Promise<Transcript> {
  const config = getConfig()

  // 1. Create cache directory for temp audio files
  const cacheDir = path.join(config.REPO_ROOT, 'cache')
  await fsp.mkdir(cacheDir, { recursive: true })
  logger.info(`Cache directory ready: ${cacheDir}`)

  // 2. Extract audio as compressed MP3 (much smaller than WAV)
  const mp3Path = path.join(cacheDir, `${video.slug}.mp3`)
  logger.info(`Extracting audio for "${video.slug}"`)
  await extractAudio(video.repoPath, mp3Path)

  // 3. Check file size and chunk if necessary
  const stats = await fsp.stat(mp3Path)
  const fileSizeMB = stats.size / (1024 * 1024)
  logger.info(`Extracted audio: ${fileSizeMB.toFixed(1)}MB`)

  let transcript: Transcript

  if (fileSizeMB <= MAX_WHISPER_SIZE_MB) {
    // Single-file transcription
    logger.info(`Transcribing audio for "${video.slug}"`)
    transcript = await transcribeAudio(mp3Path)
  } else {
    // Chunk and transcribe (very long videos, 50+ min)
    logger.info(`Audio exceeds ${MAX_WHISPER_SIZE_MB}MB, splitting into chunks`)
    const chunkPaths = await splitAudioIntoChunks(mp3Path)
    transcript = await transcribeChunks(chunkPaths)

    // Clean up chunk files
    for (const chunkPath of chunkPaths) {
      if (chunkPath !== mp3Path) {
        await fsp.unlink(chunkPath).catch(() => {})
      }
    }
  }

  // 4. Save transcript JSON
  const transcriptDir = path.join(config.OUTPUT_DIR, video.slug)
  await fsp.mkdir(transcriptDir, { recursive: true })
  const transcriptPath = path.join(transcriptDir, 'transcript.json')
  await fsp.writeFile(transcriptPath, JSON.stringify(transcript, null, 2), 'utf-8')
  logger.info(`Transcript saved: ${transcriptPath}`)

  // 5. Clean up temp audio file
  await fsp.unlink(mp3Path).catch(() => {})
  logger.info(`Cleaned up temp file: ${mp3Path}`)

  // 6. Return the transcript
  logger.info(
    `Transcription complete for "${video.slug}" — ` +
    `${transcript.segments.length} segments, ${transcript.words.length} words`
  )
  return transcript
}

/**
 * Transcribe multiple audio chunks and merge results with adjusted timestamps.
 */
async function transcribeChunks(chunkPaths: string[]): Promise<Transcript> {
  let allText = ''
  const allSegments: Segment[] = []
  const allWords: Word[] = []
  let cumulativeOffset = 0
  let totalDuration = 0
  let language = 'unknown'

  for (let i = 0; i < chunkPaths.length; i++) {
    logger.info(`Transcribing chunk ${i + 1}/${chunkPaths.length}: ${chunkPaths[i]}`)
    const result = await transcribeAudio(chunkPaths[i])

    if (i === 0) language = result.language

    // Adjust timestamps by cumulative offset
    const offsetSegments = result.segments.map((s) => ({
      ...s,
      id: allSegments.length + s.id,
      start: s.start + cumulativeOffset,
      end: s.end + cumulativeOffset,
      words: s.words.map((w) => ({
        ...w,
        start: w.start + cumulativeOffset,
        end: w.end + cumulativeOffset,
      })),
    }))

    const offsetWords = result.words.map((w) => ({
      ...w,
      start: w.start + cumulativeOffset,
      end: w.end + cumulativeOffset,
    }))

    allText += (allText ? ' ' : '') + result.text
    allSegments.push(...offsetSegments)
    allWords.push(...offsetWords)

    cumulativeOffset += result.duration
    totalDuration += result.duration
  }

  return {
    text: allText,
    segments: allSegments,
    words: allWords,
    language,
    duration: totalDuration,
  }
}
