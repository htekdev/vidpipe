import { createPromptInterface } from '../../L1-infra/readline/readlinePromises.js'
import { readJsonFile, writeJsonFile, fileExists } from '../../L1-infra/fileSystem/fileSystem.js'
import { getConfig } from '../../L1-infra/config/environment.js'
import { resolve, dirname } from '../../L1-infra/paths/paths.js'
import logger from '../../L1-infra/logger/configLogger.js'
import type { IntroOutroConfig, IntroOutroVideoType } from '../../L0-pure/types/index.js'

const PLATFORMS = ['tiktok', 'youtube', 'instagram', 'linkedin', 'x'] as const
const VIDEO_TYPES: IntroOutroVideoType[] = ['main', 'shorts', 'medium-clips']
const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:5'] as const

interface BrandJson extends Record<string, unknown> {
  introOutro?: IntroOutroConfig
}

async function loadBrand(): Promise<{ brand: BrandJson; brandPath: string }> {
  const config = getConfig()
  const brandPath = config.BRAND_PATH
  const brand = await readJsonFile<BrandJson>(brandPath, {} as BrandJson)
  return { brand, brandPath }
}

async function saveBrand(brandPath: string, brand: BrandJson): Promise<void> {
  await writeJsonFile(brandPath, brand)
  logger.info(`brand.json updated: ${brandPath}`)
}

function getIntroOutro(brand: BrandJson): IntroOutroConfig {
  return brand.introOutro ?? {
    enabled: false,
    fadeDuration: 0,
    intro: { default: '', platforms: {} },
    outro: { default: '', platforms: {} },
    rules: {
      main: { intro: true, outro: true },
      shorts: { intro: false, outro: true },
      'medium-clips': { intro: true, outro: true },
    },
    platformOverrides: {},
  }
}

// ── Show ──────────────────────────────────────────────────────────────────────

function showConfig(cfg: IntroOutroConfig): void {
  console.log()
  console.log('┌─ Intro/Outro Configuration ─────────────────────────┐')
  console.log(`│  Enabled:        ${cfg.enabled ? '✅ Yes' : '❌ No'}`)
  console.log(`│  Fade Duration:  ${cfg.fadeDuration}s`)
  console.log('├─ Files ─────────────────────────────────────────────┤')
  console.log(`│  Intro default:  ${cfg.intro?.default || '(not set)'}`)
  if (cfg.intro?.platforms && Object.keys(cfg.intro.platforms).length > 0) {
    for (const [p, path] of Object.entries(cfg.intro.platforms)) {
      console.log(`│    ${p.padEnd(12)}   ${path}`)
    }
  }
  if (cfg.intro?.aspectRatios && Object.keys(cfg.intro.aspectRatios).length > 0) {
    for (const [ratio, path] of Object.entries(cfg.intro.aspectRatios)) {
      console.log(`│    ${ratio.padEnd(12)}   ${path}`)
    }
  }
  console.log(`│  Outro default:  ${cfg.outro?.default || '(not set)'}`)
  if (cfg.outro?.platforms && Object.keys(cfg.outro.platforms).length > 0) {
    for (const [p, path] of Object.entries(cfg.outro.platforms)) {
      console.log(`│    ${p.padEnd(12)}   ${path}`)
    }
  }
  if (cfg.outro?.aspectRatios && Object.keys(cfg.outro.aspectRatios).length > 0) {
    for (const [ratio, path] of Object.entries(cfg.outro.aspectRatios)) {
      console.log(`│    ${ratio.padEnd(12)}   ${path}`)
    }
  }
  console.log('├─ Rules ─────────────────────────────────────────────┤')
  for (const vt of VIDEO_TYPES) {
    const rule = cfg.rules?.[vt]
    if (rule) {
      console.log(`│  ${vt.padEnd(14)}  intro: ${rule.intro ? '✅' : '❌'}  outro: ${rule.outro ? '✅' : '❌'}`)
    } else {
      console.log(`│  ${vt.padEnd(14)}  (uses global default)`)
    }
  }
  if (cfg.platformOverrides && Object.keys(cfg.platformOverrides).length > 0) {
    console.log('├─ Platform Overrides ────────────────────────────────┤')
    for (const [platform, videoTypes] of Object.entries(cfg.platformOverrides)) {
      for (const [vt, toggle] of Object.entries(videoTypes as Record<string, { intro?: boolean; outro?: boolean }>)) {
        const parts: string[] = []
        if (toggle.intro !== undefined) parts.push(`intro: ${toggle.intro ? '✅' : '❌'}`)
        if (toggle.outro !== undefined) parts.push(`outro: ${toggle.outro ? '✅' : '❌'}`)
        console.log(`│  ${platform}/${vt}: ${parts.join('  ')}`)
      }
    }
  }
  console.log('└─────────────────────────────────────────────────────┘')
  console.log()
}

// ── Interactive Wizard ────────────────────────────────────────────────────────

async function runWizard(brand: BrandJson, brandPath: string): Promise<void> {
  const rl = createPromptInterface()
  const cfg = getIntroOutro(brand)
  const brandDir = dirname(brandPath)

  try {
    console.log()
    console.log('🎬 Intro/Outro Setup Wizard')
    console.log('─'.repeat(50))

    // 1. Enable/disable
    const enableAnswer = await rl.question(`Enable intro/outro? (${cfg.enabled ? 'Y/n' : 'y/N'}): `)
    if (enableAnswer.trim()) {
      cfg.enabled = enableAnswer.trim().toLowerCase().startsWith('y')
    }

    // 2. Intro file
    const introDefault = cfg.intro?.default || './assets/intro.mp4'
    const introAnswer = await rl.question(`Intro video path [${introDefault}]: `)
    const introPath = introAnswer.trim() || introDefault
    cfg.intro = { ...cfg.intro, default: introPath }

    // Validate file exists
    const resolvedIntro = resolve(brandDir, introPath)
    if (!(await fileExists(resolvedIntro))) {
      console.log(`  ⚠️  File not found: ${resolvedIntro}`)
      console.log(`     (You can add it later — the path is saved)`)
    } else {
      console.log(`  ✅ Found: ${resolvedIntro}`)
    }

    // 3. Outro file
    const outroDefault = cfg.outro?.default || './assets/outro.mp4'
    const outroAnswer = await rl.question(`Outro video path [${outroDefault}]: `)
    const outroPath = outroAnswer.trim() || outroDefault
    cfg.outro = { ...cfg.outro, default: outroPath }

    const resolvedOutro = resolve(brandDir, outroPath)
    if (!(await fileExists(resolvedOutro))) {
      console.log(`  ⚠️  File not found: ${resolvedOutro}`)
      console.log(`     (You can add it later — the path is saved)`)
    } else {
      console.log(`  ✅ Found: ${resolvedOutro}`)
    }

    // 4. Fade duration
    const fadeDefault = cfg.fadeDuration ?? 0.5
    const fadeAnswer = await rl.question(`Crossfade duration in seconds [${fadeDefault}]: `)
    cfg.fadeDuration = fadeAnswer.trim() ? parseFloat(fadeAnswer.trim()) : fadeDefault
    if (!isFinite(cfg.fadeDuration) || cfg.fadeDuration < 0) {
      console.log('  ⚠️  Invalid fade duration, using 0.5s')
      cfg.fadeDuration = 0.5
    }

    // 5. Rules per video type
    console.log()
    console.log('Configure which video types get intro/outro:')
    for (const vt of VIDEO_TYPES) {
      const current = cfg.rules?.[vt] ?? { intro: true, outro: true }
      const introAns = await rl.question(`  ${vt} — include intro? (${current.intro ? 'Y/n' : 'y/N'}): `)
      const outroAns = await rl.question(`  ${vt} — include outro? (${current.outro ? 'Y/n' : 'y/N'}): `)

      const introVal = introAns.trim() ? introAns.trim().toLowerCase().startsWith('y') : current.intro
      const outroVal = outroAns.trim() ? outroAns.trim().toLowerCase().startsWith('y') : current.outro

      if (!cfg.rules) cfg.rules = {}
      cfg.rules[vt] = { intro: introVal, outro: outroVal }
    }

    // 6. Platform-specific files?
    const platformAnswer = await rl.question('\nSet platform-specific intro/outro files? (y/N): ')
    if (platformAnswer.trim().toLowerCase().startsWith('y')) {
      for (const platform of PLATFORMS) {
        const pIntro = await rl.question(`  ${platform} intro path (empty = use default): `)
        if (pIntro.trim()) {
          if (!cfg.intro!.platforms) cfg.intro!.platforms = {}
          cfg.intro!.platforms[platform] = pIntro.trim()
        }
        const pOutro = await rl.question(`  ${platform} outro path (empty = use default): `)
        if (pOutro.trim()) {
          if (!cfg.outro!.platforms) cfg.outro!.platforms = {}
          cfg.outro!.platforms[platform] = pOutro.trim()
        }
      }
    }

    // 7. Aspect-ratio-specific files?
    const ratioAnswer = await rl.question('\nSet aspect-ratio-specific intro/outro files? (y/N): ')
    if (ratioAnswer.trim().toLowerCase().startsWith('y')) {
      // Skip 16:9 since that's the default landscape ratio
      const nonDefaultRatios = ASPECT_RATIOS.filter(r => r !== '16:9')
      for (const ratio of nonDefaultRatios) {
        const rIntro = await rl.question(`  ${ratio} intro path (empty = use default): `)
        if (rIntro.trim()) {
          if (!cfg.intro!.aspectRatios) cfg.intro!.aspectRatios = {}
          cfg.intro!.aspectRatios[ratio] = rIntro.trim()
        }
        const rOutro = await rl.question(`  ${ratio} outro path (empty = use default): `)
        if (rOutro.trim()) {
          if (!cfg.outro!.aspectRatios) cfg.outro!.aspectRatios = {}
          cfg.outro!.aspectRatios[ratio] = rOutro.trim()
        }
      }
    }

    // Save
    brand.introOutro = cfg
    await saveBrand(brandPath, brand)

    console.log()
    console.log('✅ Intro/outro configuration saved!')
    showConfig(cfg)
  } finally {
    rl.close()
  }
}

// ── Subcommand Handlers ───────────────────────────────────────────────────────

async function handleEnable(brand: BrandJson, brandPath: string): Promise<void> {
  const cfg = getIntroOutro(brand)
  cfg.enabled = true
  brand.introOutro = cfg
  await saveBrand(brandPath, brand)
  console.log('✅ Intro/outro enabled')
}

async function handleDisable(brand: BrandJson, brandPath: string): Promise<void> {
  const cfg = getIntroOutro(brand)
  cfg.enabled = false
  brand.introOutro = cfg
  await saveBrand(brandPath, brand)
  console.log('❌ Intro/outro disabled')
}

async function handleSetIntro(brand: BrandJson, brandPath: string, args: string[]): Promise<void> {
  if (args.length < 1) {
    console.error('Usage: vidpipe intro-outro set-intro <path> [--platform <name>]')
    process.exitCode = 1
    return
  }
  const cfg = getIntroOutro(brand)
  const platformIdx = args.indexOf('--platform')
  if (platformIdx >= 0 && args[platformIdx + 1]) {
    const platform = args[platformIdx + 1]
    const filePath = args.filter((_, i) => i !== platformIdx && i !== platformIdx + 1)[0]
    if (!cfg.intro) cfg.intro = { platforms: {} }
    if (!cfg.intro.platforms) cfg.intro.platforms = {}
    cfg.intro.platforms[platform] = filePath
    console.log(`✅ Intro for ${platform}: ${filePath}`)
  } else {
    if (!cfg.intro) cfg.intro = {}
    cfg.intro.default = args[0]
    console.log(`✅ Default intro: ${args[0]}`)
  }
  brand.introOutro = cfg
  await saveBrand(brandPath, brand)
}

async function handleSetOutro(brand: BrandJson, brandPath: string, args: string[]): Promise<void> {
  if (args.length < 1) {
    console.error('Usage: vidpipe intro-outro set-outro <path> [--platform <name>]')
    process.exitCode = 1
    return
  }
  const cfg = getIntroOutro(brand)
  const platformIdx = args.indexOf('--platform')
  if (platformIdx >= 0 && args[platformIdx + 1]) {
    const platform = args[platformIdx + 1]
    const filePath = args.filter((_, i) => i !== platformIdx && i !== platformIdx + 1)[0]
    if (!cfg.outro) cfg.outro = { platforms: {} }
    if (!cfg.outro.platforms) cfg.outro.platforms = {}
    cfg.outro.platforms[platform] = filePath
    console.log(`✅ Outro for ${platform}: ${filePath}`)
  } else {
    if (!cfg.outro) cfg.outro = {}
    cfg.outro.default = args[0]
    console.log(`✅ Default outro: ${args[0]}`)
  }
  brand.introOutro = cfg
  await saveBrand(brandPath, brand)
}

async function handleSetIntroRatio(brand: BrandJson, brandPath: string, args: string[]): Promise<void> {
  if (args.length < 2) {
    console.error('Usage: vidpipe intro-outro set-intro-ratio <ratio> <path>')
    console.error(`  ratio: ${ASPECT_RATIOS.join(', ')}`)
    process.exitCode = 1
    return
  }
  const ratio = args[0]
  if (!ASPECT_RATIOS.includes(ratio as typeof ASPECT_RATIOS[number])) {
    console.error(`Unknown aspect ratio: ${ratio}. Must be one of: ${ASPECT_RATIOS.join(', ')}`)
    process.exitCode = 1
    return
  }
  const cfg = getIntroOutro(brand)
  if (!cfg.intro) cfg.intro = {}
  if (!cfg.intro.aspectRatios) cfg.intro.aspectRatios = {}
  cfg.intro.aspectRatios[ratio] = args[1]
  brand.introOutro = cfg
  await saveBrand(brandPath, brand)
  console.log(`✅ Intro for ${ratio}: ${args[1]}`)
}

async function handleSetOutroRatio(brand: BrandJson, brandPath: string, args: string[]): Promise<void> {
  if (args.length < 2) {
    console.error('Usage: vidpipe intro-outro set-outro-ratio <ratio> <path>')
    console.error(`  ratio: ${ASPECT_RATIOS.join(', ')}`)
    process.exitCode = 1
    return
  }
  const ratio = args[0]
  if (!ASPECT_RATIOS.includes(ratio as typeof ASPECT_RATIOS[number])) {
    console.error(`Unknown aspect ratio: ${ratio}. Must be one of: ${ASPECT_RATIOS.join(', ')}`)
    process.exitCode = 1
    return
  }
  const cfg = getIntroOutro(brand)
  if (!cfg.outro) cfg.outro = {}
  if (!cfg.outro.aspectRatios) cfg.outro.aspectRatios = {}
  cfg.outro.aspectRatios[ratio] = args[1]
  brand.introOutro = cfg
  await saveBrand(brandPath, brand)
  console.log(`✅ Outro for ${ratio}: ${args[1]}`)
}

async function handleSetFade(brand: BrandJson, brandPath: string, args: string[]): Promise<void> {
  if (args.length < 1) {
    console.error('Usage: vidpipe intro-outro set-fade <seconds>')
    process.exitCode = 1
    return
  }
  const duration = parseFloat(args[0])
  if (!isFinite(duration) || duration < 0) {
    console.error('Fade duration must be a non-negative number')
    process.exitCode = 1
    return
  }
  const cfg = getIntroOutro(brand)
  cfg.fadeDuration = duration
  brand.introOutro = cfg
  await saveBrand(brandPath, brand)
  console.log(`✅ Fade duration: ${duration}s${duration === 0 ? ' (hard cut)' : ''}`)
}

async function handleSetRule(brand: BrandJson, brandPath: string, args: string[]): Promise<void> {
  if (args.length < 2) {
    console.error('Usage: vidpipe intro-outro set-rule <video-type> <intro|outro|both> <on|off>')
    console.error('  video-type: main, shorts, medium-clips')
    console.error('  Example: vidpipe intro-outro set-rule shorts intro off')
    process.exitCode = 1
    return
  }
  const videoType = args[0] as IntroOutroVideoType
  if (!VIDEO_TYPES.includes(videoType)) {
    console.error(`Unknown video type: ${args[0]}. Must be one of: ${VIDEO_TYPES.join(', ')}`)
    process.exitCode = 1
    return
  }
  const target = args[1] // 'intro', 'outro', or 'both'
  const value = args[2]?.toLowerCase() === 'on' || args[2]?.toLowerCase() === 'true'

  const cfg = getIntroOutro(brand)
  if (!cfg.rules) cfg.rules = {}
  const current = cfg.rules[videoType] ?? { intro: true, outro: true }

  if (target === 'intro') current.intro = value
  else if (target === 'outro') current.outro = value
  else if (target === 'both') { current.intro = value; current.outro = value }
  else {
    console.error(`Unknown target: ${target}. Must be intro, outro, or both`)
    process.exitCode = 1
    return
  }

  cfg.rules[videoType] = current
  brand.introOutro = cfg
  await saveBrand(brandPath, brand)
  console.log(`✅ ${videoType}: intro=${current.intro ? 'on' : 'off'}, outro=${current.outro ? 'on' : 'off'}`)
}

function printHelp(): void {
  console.log(`
Usage: vidpipe intro-outro [subcommand] [args...]

Manage video intro and outro configuration in brand.json.

Subcommands:
  (none)           Interactive setup wizard
  show             Display current intro/outro configuration
  enable           Enable intro/outro processing
  disable          Disable intro/outro processing
  set-intro <path> [--platform <name>]   Set intro video file path
  set-outro <path> [--platform <name>]   Set outro video file path
  set-intro-ratio <ratio> <path>         Set aspect-ratio-specific intro file
  set-outro-ratio <ratio> <path>         Set aspect-ratio-specific outro file
  set-fade <seconds>                     Set crossfade duration (0 = hard cut)
  set-rule <type> <intro|outro|both> <on|off>  Configure per-video-type rules
    types: main, shorts, medium-clips
    ratios: ${ASPECT_RATIOS.join(', ')}

Examples:
  vidpipe intro-outro                          # Interactive wizard
  vidpipe intro-outro show                     # Show current config
  vidpipe intro-outro enable                   # Turn on intro/outro
  vidpipe intro-outro set-intro ./assets/intro-yt.mp4 --platform youtube
  vidpipe intro-outro set-intro-ratio 9:16 ./assets/intro-portrait.mp4
  vidpipe intro-outro set-outro-ratio 1:1 ./assets/outro-square.mp4
  vidpipe intro-outro set-fade 1.0             # 1-second crossfade
  vidpipe intro-outro set-rule shorts intro off
`)
}

// ── Entry Point ───────────────────────────────────────────────────────────────

export async function runIntroOutro(subcommand?: string, args: string[] = []): Promise<void> {
  const { brand, brandPath } = await loadBrand()

  switch (subcommand) {
    case undefined:
      await runWizard(brand, brandPath)
      break
    case 'show':
      showConfig(getIntroOutro(brand))
      break
    case 'enable':
      await handleEnable(brand, brandPath)
      break
    case 'disable':
      await handleDisable(brand, brandPath)
      break
    case 'set-intro':
      await handleSetIntro(brand, brandPath, args)
      break
    case 'set-outro':
      await handleSetOutro(brand, brandPath, args)
      break
    case 'set-intro-ratio':
      await handleSetIntroRatio(brand, brandPath, args)
      break
    case 'set-outro-ratio':
      await handleSetOutroRatio(brand, brandPath, args)
      break
    case 'set-fade':
      await handleSetFade(brand, brandPath, args)
      break
    case 'set-rule':
      await handleSetRule(brand, brandPath, args)
      break
    case 'help':
    case '--help':
      printHelp()
      break
    default:
      console.error(`Unknown subcommand: ${subcommand}`)
      printHelp()
      process.exitCode = 1
  }
}
