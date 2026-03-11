import {
  analyzeVideoEditorial as l2AnalyzeVideoEditorial,
  analyzeVideoClipDirection as l2AnalyzeVideoClipDirection,
  analyzeVideoForEnhancements as l2AnalyzeVideoForEnhancements,
} from '../../L2-clients/gemini/geminiClient.js'
import { costTracker } from '../costTracking/costTracker.js'

export async function analyzeVideoEditorial(
  videoPath: string,
  durationSeconds: number,
  model?: string,
): Promise<string> {
  const result = await l2AnalyzeVideoEditorial(videoPath, durationSeconds, model)
  costTracker.recordServiceUsage('gemini', 0, {
    model: model ?? 'gemini-2.5-pro',
    durationSeconds,
    estimatedInputTokens: Math.ceil(durationSeconds * 263),
    estimatedOutputTokens: Math.ceil(result.length / 4),
    videoFile: videoPath,
  })
  return result
}

export async function analyzeVideoClipDirection(
  videoPath: string,
  durationSeconds: number,
  model?: string,
): Promise<string> {
  const result = await l2AnalyzeVideoClipDirection(videoPath, durationSeconds, model)
  costTracker.recordServiceUsage('gemini', 0, {
    model: model ?? 'gemini-2.5-pro',
    durationSeconds,
    estimatedInputTokens: Math.ceil(durationSeconds * 263),
    estimatedOutputTokens: Math.ceil(result.length / 4),
    videoFile: videoPath,
  })
  return result
}

export async function analyzeVideoForEnhancements(
  videoPath: string,
  durationSeconds: number,
  transcript: string,
  model?: string,
): Promise<string> {
  const result = await l2AnalyzeVideoForEnhancements(videoPath, durationSeconds, transcript, model)
  costTracker.recordServiceUsage('gemini', 0, {
    model: model ?? 'gemini-2.5-pro',
    durationSeconds,
    estimatedInputTokens: Math.ceil(durationSeconds * 263),
    estimatedOutputTokens: Math.ceil(result.length / 4),
    videoFile: videoPath,
  })
  return result
}
