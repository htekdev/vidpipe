import fs from 'fs'
import path from 'path'
import { getConfig } from './environment'
import logger from './logger'

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

export function getBrandConfig(): BrandConfig {
  if (cachedBrand) return cachedBrand

  const config = getConfig()
  const brandPath = config.BRAND_PATH

  if (!fs.existsSync(brandPath)) {
    logger.warn('brand.json not found — using defaults')
    cachedBrand = { ...defaultBrand }
    return cachedBrand
  }

  const raw = fs.readFileSync(brandPath, 'utf-8')
  cachedBrand = JSON.parse(raw) as BrandConfig
  logger.info(`Brand config loaded: ${cachedBrand.name}`)
  return cachedBrand
}

// Helper to get Whisper prompt from brand vocabulary
export function getWhisperPrompt(): string {
  const brand = getBrandConfig()
  return brand.customVocabulary.join(', ')
}
