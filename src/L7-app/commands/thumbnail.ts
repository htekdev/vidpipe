import { resolve, join, basename } from '../../L1-infra/paths/paths.js'
import { fileExists, readJsonFile, listDirectory, ensureDirectory } from '../../L1-infra/fileSystem/fileSystem.js'
import { initConfig } from '../../L1-infra/config/environment.js'
import { getThumbnailConfig } from '../../L1-infra/config/brand.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { generateThumbnail } from '../../L3-services/imageGeneration/thumbnailGeneration.js'
import type { ThumbnailContentType } from '../../L0-pure/types/index.js'

export interface ThumbnailCommandOptions {
  /** Target platform for platform-specific overrides */
  platform?: string
  /** Custom prompt (overrides brand config and AI planning) */
  prompt?: string
  /** Custom output path for the generated thumbnail */
  output?: string
  /** Content type: main, shorts, or medium-clips */
  type?: string
  /** Force regeneration even if thumbnail exists */
  force?: boolean
}

/**
 * Generate a thumbnail for a recording folder or video file without
 * running the full pipeline.
 *
 * Supports two modes:
 * 1. **Recording folder**: reads existing summary/transcript for context-rich prompts
 * 2. **Video file**: generates with minimal context (title from filename)
 */
export async function runThumbnail(
  path: string,
  options: ThumbnailCommandOptions = {},
): Promise<void> {
  initConfig()

  const resolvedPath = resolve(path)
  const thumbConfig = getThumbnailConfig()

  if (!thumbConfig.enabled) {
    console.error('❌ Thumbnail generation is disabled in brand.json')
    console.log('   Set "thumbnail.enabled": true in brand.json to enable it.')
    process.exit(1)
    return
  }

  const isFolder = await isRecordingFolder(resolvedPath)
  const contentType: ThumbnailContentType = parseContentType(options.type)

  let prompt: string
  let outputPath: string

  if (isFolder) {
    console.log(`📁 Recording folder: ${resolvedPath}`)
    const context = await loadRecordingContext(resolvedPath)
    prompt = options.prompt ?? buildPromptFromContext(context, contentType)
    const outDir = options.output ? resolve(options.output) : join(resolvedPath, 'thumbnails')
    await ensureDirectory(outDir)
    outputPath = join(outDir, 'thumbnail.png')
  } else {
    if (!await fileExists(resolvedPath)) {
      console.error(`❌ File not found: ${resolvedPath}`)
      process.exit(1)
      return
    }
    console.log(`🎬 Video file: ${resolvedPath}`)
    const slug = basename(resolvedPath).replace(/\.[^.]+$/, '')
    const title = slug.replace(/[-_]/g, ' ')
    prompt = options.prompt ?? `A bold, eye-catching thumbnail for a tech video titled "${title}". Include large readable text overlay: "${title.substring(0, 30)}". High contrast, professional lighting.`
    const outDir = options.output ? resolve(options.output) : resolve('.')
    await ensureDirectory(outDir)
    outputPath = join(outDir, 'thumbnail.png')
  }

  // Skip if exists (unless force)
  if (!options.force && await fileExists(outputPath)) {
    console.log(`⏭️  Thumbnail already exists: ${outputPath}`)
    console.log('   Use --force to regenerate.')
    return
  }

  const platform = options.platform
  if (platform) console.log(`🎯 Platform: ${platform}`)
  console.log(`📝 Prompt: ${prompt.substring(0, 120)}...`)
  console.log('')

  try {
    const result = await generateThumbnail(prompt, outputPath, platform, contentType)

    if (result) {
      console.log(`✅ Thumbnail generated: ${result}`)
    } else {
      console.log('⚠️  No thumbnail generated (check brand.json thumbnail rules)')
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`Thumbnail generation failed: ${msg}`)
    console.error(`❌ Failed: ${msg}`)
    process.exit(1)
    return
  }
}

function parseContentType(type?: string): ThumbnailContentType {
  if (type === 'shorts' || type === 'short') return 'shorts'
  if (type === 'medium-clips' || type === 'medium' || type === 'medium-clip') return 'medium-clips'
  return 'main'
}

async function isRecordingFolder(path: string): Promise<boolean> {
  return (
    await fileExists(join(path, 'summary.json')) ||
    await fileExists(join(path, 'transcript.json'))
  )
}

interface RecordingContext {
  title: string
  overview: string
  topics: string[]
}

async function loadRecordingContext(folderPath: string): Promise<RecordingContext> {
  let title = basename(folderPath)
  let overview = ''
  let topics: string[] = []

  const summaryPath = join(folderPath, 'summary.json')
  if (await fileExists(summaryPath)) {
    try {
      const summary = await readJsonFile<{ title?: string; overview?: string; keyTopics?: string[] }>(summaryPath)
      title = summary.title ?? title
      overview = summary.overview ?? ''
      topics = summary.keyTopics ?? []
    } catch {
      logger.debug('Could not load summary.json')
    }
  }

  return { title, overview, topics }
}

function buildPromptFromContext(ctx: RecordingContext, contentType: ThumbnailContentType): string {
  const topicsStr = ctx.topics.length > 0 ? ` Topics: ${ctx.topics.slice(0, 3).join(', ')}.` : ''
  const overviewSnippet = ctx.overview.length > 0 ? ` ${ctx.overview.substring(0, 200)}.` : ''

  const typeLabel = contentType === 'shorts' ? 'short-form clip' : contentType === 'medium-clips' ? 'medium-length clip' : 'full video'

  return `A bold, eye-catching thumbnail for a ${typeLabel} titled "${ctx.title}". Include large readable text overlay (3-5 words max) summarizing the key takeaway.${topicsStr}${overviewSnippet} High contrast, professional lighting, tech-focused aesthetic.`
}
