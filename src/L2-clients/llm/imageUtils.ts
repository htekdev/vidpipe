/**
 * Image utilities for vision support in LLM providers.
 *
 * Handles detection of image paths in tool results and base64 encoding.
 */

import { readFileBuffer } from '../../L1-infra/fileSystem/fileSystem.js'
import { extname } from '../../L1-infra/paths/paths.js'
import type { ImageMimeType } from './types.js'

/** Result of extracting an image from a tool result */
export interface ExtractedImage {
  base64: string
  mimeType: ImageMimeType
  path: string
}

/** Check if a tool result contains an imagePath field */
export function hasImagePath(result: unknown): result is { imagePath: string } {
  return (
    typeof result === 'object' &&
    result !== null &&
    'imagePath' in result &&
    typeof (result as Record<string, unknown>).imagePath === 'string'
  )
}

/** Get MIME type from file extension */
function getMimeType(filePath: string): ImageMimeType | null {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    default:
      return null
  }
}

/**
 * Extract and encode an image from a tool result.
 * Returns null if the file doesn't exist or isn't a supported image type.
 */
export async function extractImage(result: { imagePath: string }): Promise<ExtractedImage | null> {
  const imagePath = result.imagePath

  // Check MIME type
  const mimeType = getMimeType(imagePath)
  if (!mimeType) {
    return null
  }

  // Read and encode file
  try {
    const buffer = await readFileBuffer(imagePath)
    const base64 = buffer.toString('base64')
    return { base64, mimeType, path: imagePath }
  } catch {
    // File doesn't exist or can't be read
    return null
  }
}
