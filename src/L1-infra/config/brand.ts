import { fileExistsSync, readTextFileSync } from '../fileSystem/fileSystem.js'
import { getConfig } from './environment'
import logger from '../logger/configLogger'
import type { IntroOutroConfig, ThumbnailConfig } from '../../L0-pure/types/index.js'

export interface BrandConfig {
  name: string
  handle: string
  tagline: string
  voice: {
    tone: string
    personality: string
    style: string
  }
  advocacy: {
    primary: string[]
    interests: string[]
    avoids: string[]
  }
  customVocabulary: string[]
  hashtags: {
    always: string[]
    preferred: string[]
    platforms: Record<string, string[]>
  }
  contentGuidelines: {
    shortsFocus: string
    blogFocus: string
    socialFocus: string
  }
  introOutro?: IntroOutroConfig
  thumbnail?: ThumbnailConfig
}

const defaultBrand: BrandConfig = {
  name: 'Creator',
  handle: '@creator',
  tagline: '',
  voice: {
    tone: 'professional, friendly',
    personality: 'A knowledgeable content creator.',
    style: 'Clear and concise.',
  },
  advocacy: {
    primary: [],
    interests: [],
    avoids: [],
  },
  customVocabulary: [],
  hashtags: {
    always: [],
    preferred: [],
    platforms: {},
  },
  contentGuidelines: {
    shortsFocus: 'Highlight key moments and insights.',
    blogFocus: 'Educational and informative content.',
    socialFocus: 'Engaging and authentic posts.',
  },
}

let cachedBrand: BrandConfig | null = null

/** Validate brand config and log warnings for missing or empty fields. */
function validateBrandConfig(brand: Partial<BrandConfig>): void {
  const requiredStrings: (keyof BrandConfig)[] = ['name', 'handle', 'tagline']
  for (const field of requiredStrings) {
    if (!brand[field]) {
      logger.warn(`brand.json: missing or empty field "${field}"`)
    }
  }

  const requiredObjects: { key: keyof BrandConfig; subKeys: string[] }[] = [
    { key: 'voice', subKeys: ['tone', 'personality', 'style'] },
    { key: 'advocacy', subKeys: ['primary', 'interests'] },
    { key: 'hashtags', subKeys: ['always', 'preferred'] },
    { key: 'contentGuidelines', subKeys: ['shortsFocus', 'blogFocus', 'socialFocus'] },
  ]

  for (const { key, subKeys } of requiredObjects) {
    if (!brand[key]) {
      logger.warn(`brand.json: missing section "${key}"`)
    } else {
      const section = brand[key] as Record<string, unknown>
      for (const sub of subKeys) {
        if (!section[sub] || (Array.isArray(section[sub]) && (section[sub] as unknown[]).length === 0)) {
          logger.warn(`brand.json: missing or empty field "${key}.${sub}"`)
        }
      }
    }
  }

  if (!brand.customVocabulary || brand.customVocabulary.length === 0) {
    logger.warn('brand.json: "customVocabulary" is empty — Whisper prompt will be blank')
  }

  if (brand.thumbnail?.enabled) {
    const validSizes = ['1024x1024', '1536x1024', '1024x1536', 'auto']
    if (brand.thumbnail.size && !validSizes.includes(brand.thumbnail.size)) {
      logger.warn(`brand.json: thumbnail.size "${brand.thumbnail.size}" is not a valid size (${validSizes.join(', ')})`)
    }
    const validQualities = ['low', 'medium', 'high']
    if (brand.thumbnail.quality && !validQualities.includes(brand.thumbnail.quality)) {
      logger.warn(`brand.json: thumbnail.quality "${brand.thumbnail.quality}" is not valid (${validQualities.join(', ')})`)
    }
    if (brand.thumbnail.referenceImage) {
      logger.info(`brand.json: thumbnail reference image configured: ${brand.thumbnail.referenceImage}`)
    }
  }
}

export function getBrandConfig(): BrandConfig {
  if (cachedBrand) return cachedBrand

  const config = getConfig()
  const brandPath = config.BRAND_PATH

  if (!fileExistsSync(brandPath)) {
    logger.warn('brand.json not found — using defaults')
    cachedBrand = { ...defaultBrand }
    return cachedBrand
  }

  const raw = readTextFileSync(brandPath)
  cachedBrand = JSON.parse(raw) as BrandConfig
  validateBrandConfig(cachedBrand)
  logger.info(`Brand config loaded: ${cachedBrand.name}`)
  return cachedBrand
}

// Helper to get Whisper prompt from brand vocabulary
export function getWhisperPrompt(): string {
  const brand = getBrandConfig()
  return brand.customVocabulary.join(', ')
}

/** Get the intro/outro configuration from brand config with safe defaults. */
export function getIntroOutroConfig(): IntroOutroConfig {
  const brand = getBrandConfig()
  return brand.introOutro ?? { enabled: false, fadeDuration: 0 }
}

/** Get the thumbnail configuration from brand config with safe defaults. */
export function getThumbnailConfig(): ThumbnailConfig {
  const brand = getBrandConfig()
  return brand.thumbnail ?? { enabled: false }
}
