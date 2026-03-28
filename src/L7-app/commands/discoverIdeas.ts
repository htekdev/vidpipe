import { getPendingItems, updateItem } from '../../L3-services/postStore/postStore.js'
import { readJsonFile, fileExists } from '../../L1-infra/fileSystem/fileSystem.js'
import { discoverIdeas } from '../../L6-pipeline/ideation.js'
import { getBrandConfig } from '../../L1-infra/config/brand.js'
import { join } from '../../L1-infra/paths/paths.js'
import { Platform } from '../../L0-pure/types/index.js'
import type { ShortClip, MediumClip, Segment } from '../../L0-pure/types/index.js'
import logger from '../../L1-infra/logger/configLogger.js'

export interface DiscoverIdeasCommandOptions {
  publishBy?: string
  dryRun?: boolean
}

export async function runDiscoverIdeas(options: DiscoverIdeasCommandOptions): Promise<void> {
  // 1. Load all pending queue items
  const pendingItems = await getPendingItems()
  if (pendingItems.length === 0) {
    console.log('No pending items in the publish queue.')
    return
  }

  // 2. Filter to items without ideaIds
  const untagged = pendingItems.filter(item => !item.metadata.ideaIds?.length)
  if (untagged.length === 0) {
    console.log(`All ${pendingItems.length} pending items already have ideas assigned.`)
    return
  }

  console.log(`Found ${untagged.length} untagged items (of ${pendingItems.length} total pending).\n`)

  // 3. Group by source video
  const byVideo = new Map<string, typeof untagged>()
  for (const item of untagged) {
    const key = item.metadata.sourceVideo
    const group = byVideo.get(key) ?? []
    group.push(item)
    byVideo.set(key, group)
  }

  const defaultPublishBy = options.publishBy
    ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  let totalUpdated = 0
  let totalFailed = 0

  for (const [videoDir, items] of byVideo) {
    console.log(`\n📹 ${videoDir} (${items.length} untagged items)`)

    // 4. Load transcript and clip plans from the recording folder
    const transcriptPath = join(videoDir, 'transcript.json')
    const shortsPlanPath = join(videoDir, 'shorts-plan.json')
    const mediumPlanPath = join(videoDir, 'medium-clips-plan.json')
    const summaryPath = join(videoDir, 'summary.json')

    if (!await fileExists(transcriptPath)) {
      logger.warn(`No transcript.json in ${videoDir} — skipping`)
      totalFailed += items.length
      continue
    }

    const transcript = await readJsonFile<{ segments: Segment[] }>(transcriptPath)
    const shorts: ShortClip[] = await fileExists(shortsPlanPath)
      ? await readJsonFile<ShortClip[]>(shortsPlanPath)
      : []
    const mediumClips: MediumClip[] = await fileExists(mediumPlanPath)
      ? await readJsonFile<MediumClip[]>(mediumPlanPath)
      : []

    let summaryText = ''
    if (await fileExists(summaryPath)) {
      const summary = await readJsonFile<{ overview?: string }>(summaryPath)
      summaryText = summary.overview ?? ''
    }

    if (shorts.length === 0 && mediumClips.length === 0) {
      logger.warn(`No shorts or medium clips found in ${videoDir} — skipping`)
      totalFailed += items.length
      continue
    }

    // 5. Run idea discovery via L6 bridge
    const brand = getBrandConfig()
    const defaultPlatforms = [Platform.YouTube, Platform.TikTok, Platform.Instagram, Platform.LinkedIn, Platform.X]

    console.log(`   Running idea discovery on ${shorts.length} shorts + ${mediumClips.length} medium clips...`)

    try {
      const result = await discoverIdeas({
        shorts,
        mediumClips,
        transcript: transcript.segments,
        summary: summaryText,
        publishBy: defaultPublishBy,
        defaultPlatforms,
      })

      console.log(`   ✅ ${result.matchedCount} matched, ${result.createdCount} created\n`)

      // 6. Map clip IDs to idea issue numbers
      const clipIdeaMap = new Map<string, number>()
      for (const assignment of result.assignments) {
        clipIdeaMap.set(assignment.clipId, assignment.ideaIssueNumber)
      }

      const allIdeaIds = [...new Set(result.assignments.map(a => String(a.ideaIssueNumber)))]

      // 7. Update each queue item
      for (const item of items) {
        if (options.dryRun) {
          console.log(`   [dry-run] Would update ${item.metadata.id}`)
          continue
        }

        let ideaIds: string[] | undefined

        if (item.metadata.sourceClip) {
          const matchedShort = shorts.find(s => s.slug === item.metadata.sourceClip)
          const matchedMedium = mediumClips.find(m => m.slug === item.metadata.sourceClip)
          const clipId = matchedShort?.id ?? matchedMedium?.id
          if (clipId && clipIdeaMap.has(clipId)) {
            ideaIds = [String(clipIdeaMap.get(clipId)!)]
          }
        }

        if (!ideaIds && allIdeaIds.length > 0) {
          ideaIds = allIdeaIds
        }

        if (ideaIds) {
          await updateItem(item.metadata.id, { metadata: { ideaIds } })
          console.log(`   📌 ${item.metadata.id} → idea(s) ${ideaIds.join(', ')}`)
          totalUpdated++
        } else {
          console.log(`   ⚠️  ${item.metadata.id} — no idea match found`)
          totalFailed++
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`Idea discovery failed for ${videoDir}: ${msg}`)
      totalFailed += items.length
    }
  }

  console.log(`\n🏁 Done: ${totalUpdated} items updated, ${totalFailed} skipped/failed`)
}
