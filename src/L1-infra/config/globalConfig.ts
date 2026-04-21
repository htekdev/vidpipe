import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface GlobalCredentials {
  openaiApiKey?: string
  anthropicApiKey?: string
  exaApiKey?: string
  youtubeApiKey?: string
  perplexityApiKey?: string
  lateApiKey?: string
  githubToken?: string
  geminiApiKey?: string
}

export interface GlobalDefaults {
  llmProvider?: string
  llmModel?: string
  outputDir?: string
  watchFolder?: string
  brandPath?: string
  ideasRepo?: string
  lateProfileId?: string
  geminiModel?: string
  scheduleConfig?: string
}

export interface GlobalConfig {
  credentials: GlobalCredentials
  defaults: GlobalDefaults
}

type GlobalConfigSection = keyof GlobalConfig
type StringRecord = Partial<Record<string, string>>

const CONFIG_FILE_NAME = 'config.json'
const README_FILE_NAME = 'README.txt'
const README_CONTENT = [
  'This directory stores vidpipe global configuration, including API credentials.',
  'Do not share, commit, or send these files to anyone you do not trust.',
  'Keep this directory private.',
  '',
].join('\n')

function createEmptyConfig(): GlobalConfig {
  return {
    credentials: {},
    defaults: {},
  }
}

function toStringRecord(value: unknown): StringRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }

  const entries = Object.entries(value).filter(([, entryValue]) => typeof entryValue === 'string')
  return Object.fromEntries(entries) as StringRecord
}

function ensureConfigDir(): string {
  const configDir = getConfigDir()

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, README_FILE_NAME), README_CONTENT, 'utf8')
  }

  return configDir
}

export function getConfigDir(): string {
  const overrideDir = process.env.VIDPIPE_CONFIG_DIR
  if (overrideDir) {
    return overrideDir
  }

  if (process.platform === 'win32') {
    const appDataDir = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    return join(appDataDir, 'vidpipe')
  }

  return join(homedir(), '.config', 'vidpipe')
}

export function getConfigPath(): string {
  return join(getConfigDir(), CONFIG_FILE_NAME)
}

export function loadGlobalConfig(): GlobalConfig {
  const configPath = getConfigPath()
  if (!existsSync(configPath)) {
    return createEmptyConfig()
  }

  const rawConfig = readFileSync(configPath, 'utf8')

  let parsedConfig: unknown
  try {
    parsedConfig = JSON.parse(rawConfig) as unknown
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse error'
    console.warn(`Warning: Failed to parse global config at ${configPath}: ${message}`)
    return createEmptyConfig()
  }

  if (typeof parsedConfig !== 'object' || parsedConfig === null || Array.isArray(parsedConfig)) {
    return createEmptyConfig()
  }

  const parsedRecord = parsedConfig as Record<string, unknown>

  return {
    credentials: toStringRecord(parsedRecord.credentials) as GlobalCredentials,
    defaults: toStringRecord(parsedRecord.defaults) as GlobalDefaults,
  }
}

export function saveGlobalConfig(config: GlobalConfig): void {
  ensureConfigDir()

  const configPath = getConfigPath()
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

  if (process.platform !== 'win32') {
    chmodSync(configPath, 0o600)
  }
}

export function getGlobalConfigValue(section: GlobalConfigSection, key: string): string | undefined {
  const config = loadGlobalConfig()
  const sectionValues = config[section] as StringRecord
  const value = sectionValues[key]

  return typeof value === 'string' ? value : undefined
}

export function setGlobalConfigValue(section: GlobalConfigSection, key: string, value: string): void {
  const config = loadGlobalConfig()
  const sectionValues = config[section] as StringRecord
  sectionValues[key] = value
  saveGlobalConfig(config)
}

export function resetGlobalConfig(): void {
  const configPath = getConfigPath()

  if (existsSync(configPath)) {
    unlinkSync(configPath)
  }
}

export function maskSecret(value: string): string {
  if (value.length <= 16) {
    return '****'
  }

  return `${value.slice(0, 8)}...${value.slice(-4)}`
}
