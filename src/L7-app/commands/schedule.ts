import { createLateApiClient } from '../../L3-services/lateApi/lateApiService.js'
import { initConfig } from '../../L1-infra/config/environment.js'

export interface ScheduleCommandOptions {
  platform?: string
}

export async function runSchedule(options: ScheduleCommandOptions = {}): Promise<void> {
  initConfig()

  console.log('\n📅 Posting Schedule\n')

  // Get upcoming scheduled posts from Late API
  const client = createLateApiClient()
  const posts = await client.getScheduledPosts(options.platform)
  const calendar = posts
    .filter(p => p.scheduledFor)
    .map(p => ({
      platform: p.platforms[0]?.platform ?? 'unknown',
      scheduledFor: p.scheduledFor!,
      source: 'late' as const,
      postId: p._id,
    }))
  calendar.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())

  if (calendar.length === 0) {
    console.log('No posts scheduled.')
    console.log('\nRun `vidpipe review` to review and schedule pending posts.')
    return
  }

  // Group by date
  const byDate = new Map<string, typeof calendar>()
  for (const slot of calendar) {
    const date = new Date(slot.scheduledFor).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date)!.push(slot)
  }

  // Display
  for (const [date, slots] of byDate) {
    console.log(`  ${date}`)
    for (const slot of slots) {
      const time = new Date(slot.scheduledFor).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
      const icon = getPlatformIcon(slot.platform)
      console.log(`    ${time}  ${icon} ${slot.platform}  🌐`)
    }
  }

  console.log(`\n  🌐 = scheduled in Late\n`)
}

function getPlatformIcon(platform: string): string {
  const icons: Record<string, string> = {
    tiktok: '🎵',
    youtube: '▶️',
    instagram: '📸',
    linkedin: '💼',
    twitter: '🐦',
  }
  return icons[platform] || '📱'
}
