import { getScheduleCalendar } from '../services/scheduler'
import { loadScheduleConfig } from '../services/scheduleConfig'
import { initConfig } from '../config/environment'

export interface ScheduleCommandOptions {
  platform?: string
}

export async function runSchedule(options: ScheduleCommandOptions = {}): Promise<void> {
  initConfig()

  console.log('\n📅 Posting Schedule\n')

  // Load config to show configured time slots
  const config = await loadScheduleConfig()
  
  // Get upcoming scheduled posts
  const calendar = await getScheduleCalendar()

  // Filter by platform if specified
  const filtered = options.platform 
    ? calendar.filter(s => s.platform === options.platform)
    : calendar

  if (filtered.length === 0) {
    console.log('No posts scheduled.')
    console.log('\nRun `vidpipe review` to review and schedule pending posts.')
    return
  }

  // Group by date
  const byDate = new Map<string, typeof filtered>()
  for (const slot of filtered) {
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
      const source = slot.source === 'late' ? '🌐' : '📁'
      const icon = getPlatformIcon(slot.platform)
      console.log(`    ${time}  ${icon} ${slot.platform}  ${source}`)
    }
  }

  console.log(`\n  🌐 = scheduled in Late  📁 = published locally\n`)
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
