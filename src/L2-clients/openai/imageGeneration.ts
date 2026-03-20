import { sharp } from '../../L1-infra/image/image.js'
import { dirname } from '../../L1-infra/paths/paths.js'
import { fetchRaw } from '../../L1-infra/http/httpClient.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { getConfig } from '../../L1-infra/config/environment.js'
import { ensureDirectory, writeFileBuffer, readFileBuffer } from '../../L1-infra/fileSystem/fileSystem.js'

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
 * Validate and sanitize raw image bytes from the API response.
 * Re-encodes as PNG via Sharp to break taint chain and ensure valid format.
 */
async function validateImageBuffer(rawBuffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(rawBuffer)
      .png()
      .toBuffer()
  } catch (error) {
    logger.error('[ImageGen] Failed to validate image data from API', { error })
    throw new Error('[ImageGen] Invalid image data received from API - not a valid image format')
  }
}

/**
 * Extract b64_json from OpenAI image API response and decode to Buffer.
 */
function extractImageBuffer(result: ImageApiResponse): Buffer {
  const b64 = result.data?.[0]?.b64_json
  if (!b64) {
    logger.error('[ImageGen] No b64_json in API response')
    throw new Error('[ImageGen] API response missing b64_json image data')
  }
  return Buffer.from(b64, 'base64')
}

/**
 * Generate an image using OpenAI's gpt-image-1.5 model (text-to-image).
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
  const rawBuffer = extractImageBuffer(result)
  const validatedBuffer = await validateImageBuffer(rawBuffer)

  await ensureDirectory(dirname(outputPath))
  await writeFileBuffer(outputPath, validatedBuffer)

  logger.info(`[ImageGen] Image saved to ${outputPath} (${validatedBuffer.length} bytes)`)

  return outputPath
}

/**
 * Generate an image using OpenAI's gpt-image-1.5 model with a reference image
 * for style transfer. Uses the /images/edits endpoint with multipart/form-data.
 *
 * The reference image provides the visual style (colors, composition, aesthetic)
 * while the prompt describes the new content to generate.
 *
 * @param prompt - Description of the image to generate
 * @param outputPath - Where to save the generated PNG
 * @param referenceImagePath - Path to the reference image for style transfer
 * @param options - Optional configuration (size, quality, style)
 * @returns Path to the saved image file
 */
export async function generateImageWithReference(
  prompt: string,
  outputPath: string,
  referenceImagePath: string,
  options?: ImageGenerationOptions,
): Promise<string> {
  const config = getConfig()
  if (!config.OPENAI_API_KEY) {
    throw new Error('[ImageGen] OPENAI_API_KEY is required for image generation')
  }

  const size = options?.size ?? 'auto'
  const quality = options?.quality ?? 'high'
  const stylePrefix = options?.style ? `Style: ${options.style}. ` : ''
  const fullPrompt = `${stylePrefix}Produce an image in the same visual style, color palette, and aesthetic as the reference image provided. ${prompt}`

  logger.info(`[ImageGen] Generating image with reference: ${prompt.substring(0, 100)}...`)
  logger.debug(`[ImageGen] Reference: ${referenceImagePath}, Size: ${size}, Quality: ${quality}`)

  const imageBuffer = await readFileBuffer(referenceImagePath)

  // Resize reference image if > 4MB to stay within API limits
  let processedImage: Buffer = imageBuffer
  if (imageBuffer.length > 4 * 1024 * 1024) {
    logger.info('[ImageGen] Reference image > 4MB, resizing...')
    processedImage = await sharp(imageBuffer)
      .resize(1536, 1024, { fit: 'inside' })
      .png()
      .toBuffer()
  }

  // Build multipart/form-data — gpt-image models require multipart, not JSON
  const boundary = `----ImageGenBoundary${Date.now()}`
  const parts: Buffer[] = []

  const addField = (name: string, value: string): void => {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ))
  }

  addField('model', 'gpt-image-1.5')
  addField('prompt', fullPrompt)
  addField('size', size)
  addField('quality', quality)
  addField('n', '1')

  // Add image as file part
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="reference.png"\r\nContent-Type: image/png\r\n\r\n`,
  ))
  parts.push(processedImage)
  parts.push(Buffer.from('\r\n'))

  // Closing boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`))

  const body = Buffer.concat(parts)

  const response = await fetchRaw('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
    },
    body,
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`[ImageGen] Edit API error (${response.status}): ${errorText}`)
    throw new Error(`[ImageGen] OpenAI Edit API returned ${response.status}: ${errorText}`)
  }

  const result = (await response.json()) as ImageApiResponse
  const rawBuffer = extractImageBuffer(result)
  const validatedBuffer = await validateImageBuffer(rawBuffer)

  await ensureDirectory(dirname(outputPath))
  await writeFileBuffer(outputPath, validatedBuffer)

  logger.info(`[ImageGen] Image with reference saved to ${outputPath} (${validatedBuffer.length} bytes)`)

  return outputPath
}
