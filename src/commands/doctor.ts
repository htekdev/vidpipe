import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { createRequire } from 'module'
import path from 'path'
import { getProvider, type ProviderName } from '../providers/index.js'

const require = createRequire(import.meta.url)

interface CheckResult {
  label: string
  ok: boolean
  required: boolean
  message: string
}

function resolveFFmpegPath(): { path: string; source: string } {
  if (process.env.FFMPEG_PATH) {
    return { path: process.env.FFMPEG_PATH, source: 'FFMPEG_PATH env' }
  }
  try {
    const staticPath = require('ffmpeg-static') as string
    if (staticPath && existsSync(staticPath)) {
      return { path: staticPath, source: 'ffmpeg-static' }
    }
  } catch { /* not available */ }
  return { path: 'ffmpeg', source: 'system PATH' }
}

function resolveFFprobePath(): { path: string; source: string } {
  if (process.env.FFPROBE_PATH) {
    return { path: process.env.FFPROBE_PATH, source: 'FFPROBE_PATH env' }
  }
  try {
    const { path: probePath } = require('@ffprobe-installer/ffprobe') as { path: string }
    if (probePath && existsSync(probePath)) {
      return { path: probePath, source: '@ffprobe-installer/ffprobe' }
    }
  } catch { /* not available */ }
  return { path: 'ffprobe', source: 'system PATH' }
}

function parseVersionFromOutput(output: string): string {
  const match = output.match(/(\d+\.\d+(?:\.\d+)?)/)
  return match ? match[1] : 'unknown'
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
    const result = spawnSync(binPath, ['-version'], { encoding: 'utf-8', timeout: 10_000 })
    if (result.status === 0 && result.stdout) {
      const ver = parseVersionFromOutput(result.stdout)
      return { label: 'FFmpeg', ok: true, required: true, message: `FFmpeg ${ver} (source: ${source})` }
    }
  } catch { /* spawn failed */ }
  return {
    label: 'FFmpeg',
    ok: false,
    required: true,
    message: 'FFmpeg not found — install with: winget install Gyan.FFmpeg (Windows) / brew install ffmpeg (macOS)',
  }
}

function checkFFprobe(): CheckResult {
  const { path: binPath, source } = resolveFFprobePath()
  try {
    const result = spawnSync(binPath, ['-version'], { encoding: 'utf-8', timeout: 10_000 })
    if (result.status === 0 && result.stdout) {
      const ver = parseVersionFromOutput(result.stdout)
      return { label: 'FFprobe', ok: true, required: true, message: `FFprobe ${ver} (source: ${source})` }
    }
  } catch { /* spawn failed */ }
  return {
    label: 'FFprobe',
    ok: false,
    required: true,
    message: 'FFprobe not found — install with: winget install Gyan.FFmpeg (Windows) / brew install ffmpeg (macOS)',
  }
}

function checkOpenAIKey(): CheckResult {
  const set = !!process.env.OPENAI_API_KEY
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
  const set = !!process.env.EXA_API_KEY
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
    const result = spawnSync('git', ['--version'], { encoding: 'utf-8', timeout: 10_000 })
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
  const watchDir = process.env.WATCH_FOLDER || path.join(process.cwd(), 'watch')
  const exists = existsSync(watchDir)
  return {
    label: 'Watch folder',
    ok: exists,
    required: false,
    message: exists
      ? `Watch folder exists: ${watchDir}`
      : `Watch folder missing: ${watchDir}`,
  }
}

export function runDoctor(): void {
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

  // LLM Provider section
  console.log('\nLLM Provider')
  const providerName = (process.env.LLM_PROVIDER as ProviderName) ?? 'copilot'
  const isDefault = !process.env.LLM_PROVIDER
  const providerLabel = isDefault ? `${providerName} (default)` : providerName

  try {
    const provider = getProvider(providerName)
    const available = provider.isAvailable()

    if (providerName === 'copilot') {
      console.log(`  ✅ Provider: ${providerLabel}`)
      console.log('  ✅ Copilot — uses GitHub auth')
    } else if (providerName === 'openai') {
      console.log(`  ✅ Provider: ${providerLabel}`)
      if (available) {
        console.log('  ✅ OPENAI_API_KEY is set (also used for Whisper)')
      } else {
        console.log('  ❌ OPENAI_API_KEY not set')
        results.push({ label: 'LLM Provider', ok: false, required: true, message: 'OPENAI_API_KEY not set for OpenAI LLM' })
      }
    } else if (providerName === 'claude') {
      console.log(`  ✅ Provider: ${providerLabel}`)
      if (available) {
        console.log('  ✅ ANTHROPIC_API_KEY is set')
      } else {
        console.log('  ❌ ANTHROPIC_API_KEY not set')
        results.push({ label: 'LLM Provider', ok: false, required: true, message: 'ANTHROPIC_API_KEY not set for Claude LLM' })
      }
    }

    const defaultModel = provider.getDefaultModel()
    const modelOverride = process.env.LLM_MODEL
    if (modelOverride) {
      console.log(`  ℹ️  Model override: ${modelOverride} (default: ${defaultModel})`)
    } else {
      console.log(`  ℹ️  Default model: ${defaultModel}`)
    }
  } catch (err) {
    console.log(`  ❌ Provider: ${providerLabel} — ${(err as Error).message}`)
    results.push({ label: 'LLM Provider', ok: false, required: true, message: `Unknown provider: ${providerName}` })
  }

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
