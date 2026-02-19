import { sharp } from '../../L1-infra/image/image.js'
import { dirname } from '../../L1-infra/paths/paths.js'
import { fetchRaw } from '../../L1-infra/http/httpClient.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { getConfig } from '../../L1-infra/config/environment.js'
import { ensureDirectory, writeFileBuffer } from '../../L1-infra/fileSystem/fileSystem.js'

type ImageSize = '1024x1024' | '1536x1024' | '1024x1536' | 'auto'
type ImageQuality = 'low' | 'medium' | 'high'

interface ImageGenerationOptions {
  size?: ImageSize
  quality?: ImageQuality
  style?: string
}

interface ImageApiResponse {
  data?: Array<{ b64_json?: string }>
  error?: { message?: string }
}

export const COST_BY_QUALITY: Record<ImageQuality, number> = {
  low: 0.04,
  medium: 0.07,
  high: 0.07,
}

/** Base styling appended to every image prompt to ensure overlays stand out on video */
const IMAGE_BASE_PROMPT = `\n\nRendering requirements: The image MUST have a solid opaque background (not transparent). Include a thin border or subtle drop shadow around the entire image. Use a clean, flat design style suitable for overlaying on top of video content. The image should look like a polished infographic card that clearly separates from whatever is behind it.`

/**
 * Generate an image using OpenAI's DALL-E 3 model.
 *
 * @param prompt - Detailed description of the image to generate
 * @param outputPath - Where to save the generated PNG
 * @param options - Optional configuration
 * @returns Path to the saved image file
 */
export async function generateImage(
  prompt: string,
  outputPath: string,
  options?: ImageGenerationOptions,
): Promise<string> {
  const config = getConfig()
  if (!config.OPENAI_API_KEY) {
    throw new Error('[ImageGen] OPENAI_API_KEY is required for image generation')
  }

  const size = options?.size ?? 'auto'
  const quality = options?.quality ?? 'high'
  const fullPrompt = (options?.style ? `${prompt}\n\nStyle: ${options.style}` : prompt) + IMAGE_BASE_PROMPT

  logger.info(`[ImageGen] Generating image: ${prompt.substring(0, 100)}...`)
  logger.debug(`[ImageGen] Size: ${size}, Quality: ${quality}`)

  const response = await fetchRaw('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-1.5',
      prompt: fullPrompt,
      n: 1,
      size,
      quality,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[ImageGen] API error (${response.status}): ${errorText}`)
    throw new Error(`[ImageGen] OpenAI API returned ${response.status}: ${errorText}`)
  }

  const result = (await response.json()) as ImageApiResponse
  const b64 = result.data?.[0]?.b64_json

  if (!b64) {
    logger.error('[ImageGen] No b64_json in API response')
    throw new Error('[ImageGen] API response missing b64_json image data')
  }

  const rawBuffer = Buffer.from(b64, 'base64')

  // Validate and sanitize the image data using Sharp
  // This ensures the data is a valid image and breaks the taint chain for CodeQL
  // Sharp will throw if the data is not a valid image format
  let validatedBuffer: Buffer
  try {
    validatedBuffer = await sharp(rawBuffer)
      .png() // Re-encode as PNG to ensure format consistency
      .toBuffer()
  } catch (error) {
    logger.error('[ImageGen] Failed to validate image data from API', { error })
    throw new Error('[ImageGen] Invalid image data received from API - not a valid image format')
  }

  await ensureDirectory(dirname(outputPath))
  await writeFileBuffer(outputPath, validatedBuffer)

  logger.info(`[ImageGen] Image saved to ${outputPath} (${validatedBuffer.length} bytes)`)

  return outputPath
}
