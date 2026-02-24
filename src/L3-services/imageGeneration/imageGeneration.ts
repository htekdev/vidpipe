import {
  generateImage as l2GenerateImage,
  COST_BY_QUALITY,
} from '../../L2-clients/openai/imageGeneration.js'
import { costTracker } from '../costTracking/costTracker.js'

export { COST_BY_QUALITY }

export interface ImageGenerationOptions {
  size?: '1024x1024' | '1536x1024' | '1024x1536' | 'auto'
  quality?: 'low' | 'medium' | 'high'
  style?: string
}

export async function generateImage(
  prompt: string,
  outputPath: string,
  options?: ImageGenerationOptions,
): Promise<string> {
  const result = await l2GenerateImage(prompt, outputPath, options)
  const quality = options?.quality ?? 'high'
  costTracker.recordServiceUsage('openai-image', COST_BY_QUALITY[quality], {
    model: 'gpt-image-1.5',
    size: options?.size ?? 'auto',
    quality,
    prompt: prompt.substring(0, 200),
  })
  return result
}
