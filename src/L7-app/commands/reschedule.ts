import { initConfig } from '../../L1-infra/config/environment.js'
import { rescheduleIdeaPosts } from '../../L3-services/scheduler/scheduler.js'
import logger from '../../L1-infra/logger/configLogger.js'

export interface RescheduleCommandOptions {
  dryRun?: boolean
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }) + ' ' + d.toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const PLATFORM_ICON: Record<string, string> = {
  tiktok: '🎵',
  youtube: '▶️',
  instagram: '📸',
  linkedin: '💼',
  twitter: '🐦',
  x: '🐦',
}

export async function runReschedule(options: RescheduleCommandOptions = {}): Promise<void> {
  initConfig()

  if (options.dryRun) {
    console.log('\n🔍 Dry run — no changes will be made\n')
  }

  console.log('📅 Rescheduling idea-linked posts for optimal slot placement...\n')

  const result = await rescheduleIdeaPosts({ dryRun: options.dryRun })

  if (result.details.length === 0) {
    console.log('No idea-linked posts found to reschedule.')
    return
  }

  // Group by platform for display
  const byPlatform = new Map<string, typeof result.details>()
  for (const detail of result.details) {
    const group = byPlatform.get(detail.platform) ?? []
    group.push(detail)
    byPlatform.set(detail.platform, group)
  }

  for (const [platform, details] of byPlatform) {
    const icon = PLATFORM_ICON[platform] ?? '📱'
    console.log(`${icon} ${platform}`)
    for (const d of details) {
      const old = d.oldSlot ? formatDate(d.oldSlot) : 'unscheduled'
      if (d.error) {
        console.log(`  ❌ ${d.itemId}: ${d.error}`)
      } else if (d.oldSlot && d.newSlot && d.oldSlot !== d.newSlot) {
        console.log(`  🔄 ${d.itemId}: ${old} → ${formatDate(d.newSlot!)}`)
      } else {
        console.log(`  ✅ ${d.itemId}: ${old} (unchanged)`)
      }
    }
    console.log()
  }

  console.log(`Summary: ${result.rescheduled} moved, ${result.unchanged} unchanged, ${result.failed} failed`)
}
