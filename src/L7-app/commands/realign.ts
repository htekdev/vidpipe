import { initConfig } from '../../L1-infra/config/environment.js'
import { buildRealignPlan, executeRealignPlan } from '../../L3-services/scheduler/realign.js'

export interface RealignCommandOptions {
  platform?: string
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

const STATUS_ICON: Record<string, string> = {
  scheduled: '📅',
  draft: '📝',
  cancelled: '🚫',
  failed: '❌',
}

const PLATFORM_ICON: Record<string, string> = {
  tiktok: '🎵',
  youtube: '▶️',
  instagram: '📸',
  linkedin: '💼',
  twitter: '🐦',
}

export async function runRealign(options: RealignCommandOptions = {}): Promise<void> {
  initConfig()

  console.log('\n🔄 Realign Late Posts\n')

  if (options.platform) {
    console.log(`  Platform filter: ${options.platform}`)
  }
  if (options.dryRun) {
    console.log('  Mode: DRY RUN (no changes will be made)\n')
  }

  console.log('  Fetching posts from Late API...')
  const plan = await buildRealignPlan({ platform: options.platform })

  if (plan.totalFetched === 0) {
    console.log('  ✅ No posts found to realign.\n')
    return
  }

  console.log(`  Found ${plan.totalFetched} total post(s)`)
  if (plan.skipped > 0) {
    console.log(`  ✅ ${plan.skipped} post(s) already on valid slots — skipped`)
  }
  if (plan.unmatched > 0) {
    console.log(`  ⚠️  ${plan.unmatched} post(s) had no local metadata match (defaulting to "short" clip type)`)
  }
  console.log(`  ${plan.posts.length} post(s) will be realigned`)
  if (plan.toCancel.length > 0) {
    console.log(`  ${plan.toCancel.length} post(s) will be cancelled (no matching schedule slots)`)
  }
  console.log()

  if (plan.posts.length === 0 && plan.toCancel.length === 0) {
    console.log('  ✅ Nothing to realign.\n')
    return
  }

  // Show posts to cancel
  if (plan.toCancel.length > 0) {
    console.log('  🚫 Posts to cancel:')
    const cancelByPlatform = new Map<string, typeof plan.toCancel>()
    for (const p of plan.toCancel) {
      if (!cancelByPlatform.has(p.platform)) cancelByPlatform.set(p.platform, [])
      cancelByPlatform.get(p.platform)!.push(p)
    }
    for (const [platform, posts] of cancelByPlatform) {
      const icon = PLATFORM_ICON[platform] ?? '📱'
      console.log(`    ${icon} ${platform} (${posts.length} posts) — ${posts[0].reason}`)
      for (const entry of posts.slice(0, 5)) {
        const preview = entry.post.content.slice(0, 50).replace(/\n/g, ' ')
        console.log(`      [${entry.clipType}] "${preview}..."`)
      }
      if (posts.length > 5) {
        console.log(`      ... and ${posts.length - 5} more`)
      }
    }
    console.log()
  }

  // Show posts to realign
  if (plan.posts.length > 0) {
    // Group by platform for display
    const byPlatform = new Map<string, typeof plan.posts>()
    for (const p of plan.posts) {
      if (!byPlatform.has(p.platform)) byPlatform.set(p.platform, [])
      byPlatform.get(p.platform)!.push(p)
    }

    for (const [platform, posts] of byPlatform) {
      const icon = PLATFORM_ICON[platform] ?? '📱'
      console.log(`  ${icon} ${platform} (${posts.length} posts)`)

      for (const entry of posts) {
        const statusIcon = STATUS_ICON[entry.post.status] ?? '❓'
        const oldTime = entry.oldScheduledFor ? formatDate(entry.oldScheduledFor) : 'unscheduled'
        const newTime = formatDate(entry.newScheduledFor)
        const preview = entry.post.content.slice(0, 50).replace(/\n/g, ' ')
        console.log(`    ${statusIcon} [${entry.clipType}] "${preview}..."`)
        console.log(`       ${oldTime} → ${newTime}`)
      }
      console.log()
    }
  }

  if (options.dryRun) {
    console.log('  🏁 Dry run complete — no changes made.\n')
    return
  }

  console.log('  🚀 Executing updates...\n')
  const result = await executeRealignPlan(plan)

  console.log(`  ✅ Updated: ${result.updated}`)
  if (result.cancelled > 0) {
    console.log(`  🚫 Cancelled: ${result.cancelled}`)
  }
  if (result.failed > 0) {
    console.log(`  ❌ Failed: ${result.failed}`)
    for (const err of result.errors) {
      console.log(`     ${err.postId}: ${err.error}`)
    }
  }
  console.log()
}
