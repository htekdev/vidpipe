import { spawnCommand, createModuleRequire } from '../../L1-infra/process/process.js'
import { fileExistsSync } from '../../L1-infra/fileSystem/fileSystem.js'
import { join } from '../../L1-infra/paths/paths.js'
import { getConfig } from '../../L1-infra/config/environment.js'
import { LateApiClient } from '../../L3-services/lateApi/lateApiService.js'
import { loadScheduleConfig } from '../../L3-services/scheduler/scheduleConfig.js'
import type { ProviderName } from '../../L3-services/llm/index.js'

const require = createModuleRequire(import.meta.url)

interface CheckResult {
  label: string
  ok: boolean
  required: boolean
  message: string
}

/** Normalize LLM_PROVIDER the same way the provider factory does. */
export function normalizeProviderName(raw: string | undefined): string {
  return (raw || 'copilot').trim().toLowerCase()
}

function resolveFFmpegPath(): { path: string; source: string } {
  const config = getConfig()
  if (config.FFMPEG_PATH && config.FFMPEG_PATH !== 'ffmpeg') {
    return { path: config.FFMPEG_PATH, source: 'FFMPEG_PATH config' }
  }
  try {
    const staticPath = require('ffmpeg-static') as string
    if (staticPath && fileExistsSync(staticPath)) {
      return { path: staticPath, source: 'ffmpeg-static' }
    }
  } catch { /* not available */ }
  return { path: 'ffmpeg', source: 'system PATH' }
}

function resolveFFprobePath(): { path: string; source: string } {
  const config = getConfig()
  if (config.FFPROBE_PATH && config.FFPROBE_PATH !== 'ffprobe') {
    return { path: config.FFPROBE_PATH, source: 'FFPROBE_PATH config' }
  }
  try {
    const { path: probePath } = require('@ffprobe-installer/ffprobe') as { path: string }
    if (probePath && fileExistsSync(probePath)) {
      return { path: probePath, source: '@ffprobe-installer/ffprobe' }
    }
  } catch { /* not available */ }
  return { path: 'ffprobe', source: 'system PATH' }
}

function parseVersionFromOutput(output: string): string {
  const match = output.match(/(\d+\.\d+(?:\.\d+)?)/)
  return match ? match[1] : 'unknown'
}

function getFFmpegInstallHint(): string {
  const platform = process.platform
  const lines = ['Install FFmpeg:']
  if (platform === 'win32') {
    lines.push('  winget install Gyan.FFmpeg')
    lines.push('  choco install ffmpeg        (alternative)')
  } else if (platform === 'darwin') {
    lines.push('  brew install ffmpeg')
  } else {
    lines.push('  sudo apt install ffmpeg     (Debian/Ubuntu)')
    lines.push('  sudo dnf install ffmpeg     (Fedora)')
    lines.push('  sudo pacman -S ffmpeg       (Arch)')
  }
  lines.push('  Or set FFMPEG_PATH to a custom binary location')
  return lines.join('\n          ')
}

function checkNode(): CheckResult {
  const raw = process.version // e.g. "v20.11.1"
  const major = parseInt(raw.slice(1), 10)
  const ok = major >= 20
  return {
    label: 'Node.js',
    ok,
    required: true,
    message: ok
      ? `Node.js ${raw} (required: ≥20)`
      : `Node.js ${raw} — version ≥20 required`,
  }
}

function checkFFmpeg(): CheckResult {
  const { path: binPath, source } = resolveFFmpegPath()
  try {
    const result = spawnCommand(binPath, ['-version'], { timeout: 10_000 })
    if (result.status === 0 && result.stdout) {
      const ver = parseVersionFromOutput(result.stdout)
      return { label: 'FFmpeg', ok: true, required: true, message: `FFmpeg ${ver} (source: ${source})` }
    }
  } catch { /* spawn failed */ }
  return {
    label: 'FFmpeg',
    ok: false,
    required: true,
    message: `FFmpeg not found — ${getFFmpegInstallHint()}`,
  }
}

function checkFFprobe(): CheckResult {
  const { path: binPath, source } = resolveFFprobePath()
  try {
    const result = spawnCommand(binPath, ['-version'], { timeout: 10_000 })
    if (result.status === 0 && result.stdout) {
      const ver = parseVersionFromOutput(result.stdout)
      return { label: 'FFprobe', ok: true, required: true, message: `FFprobe ${ver} (source: ${source})` }
    }
  } catch { /* spawn failed */ }
  return {
    label: 'FFprobe',
    ok: false,
    required: true,
    message: `FFprobe not found — usually included with FFmpeg.\n          ${getFFmpegInstallHint()}`,
  }
}

function checkOpenAIKey(): CheckResult {
  const set = !!getConfig().OPENAI_API_KEY
  return {
    label: 'OPENAI_API_KEY',
    ok: set,
    required: true,
    message: set
      ? 'OPENAI_API_KEY is set'
      : 'OPENAI_API_KEY not set — get one at https://platform.openai.com/api-keys',
  }
}

function checkExaKey(): CheckResult {
  const set = !!getConfig().EXA_API_KEY
  return {
    label: 'EXA_API_KEY',
    ok: set,
    required: false,
    message: set
      ? 'EXA_API_KEY is set'
      : 'EXA_API_KEY not set (optional — web search in social posts)',
  }
}

function checkGit(): CheckResult {
  try {
    const result = spawnCommand('git', ['--version'], { timeout: 10_000 })
    if (result.status === 0 && result.stdout) {
      const ver = parseVersionFromOutput(result.stdout)
      return { label: 'Git', ok: true, required: false, message: `Git ${ver}` }
    }
  } catch { /* spawn failed */ }
  return {
    label: 'Git',
    ok: false,
    required: false,
    message: 'Git not found (optional — needed for auto-commit stage)',
  }
}

function checkWatchFolder(): CheckResult {
  const watchDir = getConfig().WATCH_FOLDER || join(process.cwd(), 'watch')
  const exists = fileExistsSync(watchDir)
  return {
    label: 'Watch folder',
    ok: exists,
    required: false,
    message: exists
      ? `Watch folder exists: ${watchDir}`
      : `Watch folder missing: ${watchDir}`,
  }
}

export async function runDoctor(): Promise<void> {
  console.log('\n🔍 VidPipe Doctor — Checking prerequisites...\n')

  const results: CheckResult[] = [
    checkNode(),
    checkFFmpeg(),
    checkFFprobe(),
    checkOpenAIKey(),
    checkExaKey(),
    checkGit(),
    checkWatchFolder(),
  ]

  for (const r of results) {
    const icon = r.ok ? '✅' : r.required ? '❌' : '⬚'
    console.log(`  ${icon} ${r.message}`)
  }

  // LLM Provider section — check config values to avoid silent fallback
  const config = getConfig()
  console.log('\nLLM Provider')
  const providerName = normalizeProviderName(config.LLM_PROVIDER) as ProviderName
  const isDefault = !config.LLM_PROVIDER
  const providerLabel = isDefault ? `${providerName} (default)` : providerName
  const validProviders: ProviderName[] = ['copilot', 'openai', 'claude']

  if (!validProviders.includes(providerName)) {
    console.log(`  ❌ Provider: ${providerLabel} — unknown provider`)
    results.push({ label: 'LLM Provider', ok: false, required: true, message: `Unknown provider: ${providerName}` })
  } else if (providerName === 'copilot') {
    console.log(`  ✅ Provider: ${providerLabel}`)
    console.log('  ✅ Copilot — uses GitHub auth')
  } else if (providerName === 'openai') {
    console.log(`  ✅ Provider: ${providerLabel}`)
    if (config.OPENAI_API_KEY) {
      console.log('  ✅ OPENAI_API_KEY is set (also used for Whisper)')
    } else {
      console.log('  ❌ OPENAI_API_KEY not set (required for openai provider)')
      results.push({ label: 'LLM Provider', ok: false, required: true, message: 'OPENAI_API_KEY not set for OpenAI LLM' })
    }
  } else if (providerName === 'claude') {
    console.log(`  ✅ Provider: ${providerLabel}`)
    if (config.ANTHROPIC_API_KEY) {
      console.log('  ✅ ANTHROPIC_API_KEY is set')
    } else {
      console.log('  ❌ ANTHROPIC_API_KEY not set (required for claude provider)')
      results.push({ label: 'LLM Provider', ok: false, required: true, message: 'ANTHROPIC_API_KEY not set for Claude LLM' })
    }
  }

  const defaultModels: Record<ProviderName, string> = {
    copilot: 'Claude Opus 4.6',
    openai: 'gpt-4o',
    claude: 'claude-opus-4.6',
  }
  if (validProviders.includes(providerName)) {
    const defaultModel = defaultModels[providerName]
    const modelOverride = config.LLM_MODEL
    if (modelOverride) {
      console.log(`  ℹ️  Model override: ${modelOverride} (default: ${defaultModel})`)
    } else {
      console.log(`  ℹ️  Default model: ${defaultModel}`)
    }
  }

  // Late API (optional — social publishing)
  console.log('\nSocial Publishing')
  await checkLateApi(config.LATE_API_KEY)

  // Schedule config
  await checkScheduleConfig()

  const failedRequired = results.filter(r => r.required && !r.ok)

  console.log()
  if (failedRequired.length === 0) {
    console.log('  All required checks passed! ✅\n')
    process.exit(0)
  } else {
    console.log(`  ${failedRequired.length} required check${failedRequired.length > 1 ? 's' : ''} failed ❌\n`)
    process.exit(1)
  }
}

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  twitter: 'X/Twitter',
}

async function checkLateApi(apiKey: string): Promise<void> {
  if (!apiKey) {
    console.log('  ⬚ Late API key: not configured (optional — set LATE_API_KEY for social publishing)')
    return
  }

  try {
    const client = new LateApiClient(apiKey)
    const { valid, profileName, error } = await client.validateConnection()

    if (!valid) {
      console.log(`  ❌ Late API key: invalid (${error ?? 'unknown error'})`)
      return
    }

    console.log(`  ✅ Late API key: connected to profile "${profileName ?? 'unknown'}"`)

    // List connected accounts
    try {
      const accounts = await client.listAccounts()
      if (accounts.length === 0) {
        console.log('  ⚠️ No social accounts connected in Late dashboard')
      } else {
        for (const acct of accounts) {
          const label = PLATFORM_LABELS[acct.platform] ?? acct.platform
          const handle = acct.username ? `@${acct.username}` : acct.displayName
          console.log(`  ✅ ${label} — ${handle}`)
        }
      }
    } catch {
      console.log('  ⚠️ Could not fetch connected accounts')
    }
  } catch {
    console.log('  ❌ Late API key: could not connect (network error)')
  }
}

async function checkScheduleConfig(): Promise<void> {
  const schedulePath = join(process.cwd(), 'schedule.json')

  if (!fileExistsSync(schedulePath)) {
    console.log('  ⬚ Schedule config: schedule.json not found (will use defaults on first run)')
    return
  }

  try {
    const scheduleConfig = await loadScheduleConfig(schedulePath)
    const platformCount = Object.keys(scheduleConfig.platforms).length
    console.log(`  ✅ Schedule config: schedule.json found (${platformCount} platform${platformCount !== 1 ? 's' : ''} configured)`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`  ❌ Schedule config: schedule.json invalid — ${msg}`)
  }
}
