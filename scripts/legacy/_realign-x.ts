import 'dotenv/config'
import { readFile } from 'fs/promises'

const k = process.env.LATE_API_KEY!
const sched = JSON.parse(await readFile('schedule.json', 'utf-8'))
const xConfig = sched.platforms.twitter

const allSlots: string[] = []
if (xConfig.byClipType) {
  for (const [, cfg] of Object.entries(xConfig.byClipType) as [string, any][]) {
    for (const slot of cfg.slots) allSlots.push(typeof slot === 'string' ? slot : slot.time)
  }
}
const uniqueSlots = [...new Set(allSlots)].sort()
console.log('X slots (' + uniqueSlots.length + '):', uniqueSlots.join(', '))

const r = await fetch('https://getlate.dev/api/v1/posts?platform=twitter&status=scheduled&limit=100', {
  headers: { 'Authorization': 'Bearer ' + k },
})
const posts = (await r.json()).posts || []
posts.sort((a: any, b: any) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
console.log('Total scheduled X posts:', posts.length)

const taken = new Set<string>()
const reschedules: { id: string, old: string, newISO: string, newDisplay: string }[] = []

function getDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
}
function getTimeKey(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false })
}
function buildISO(dateKey: string, slotTime: string): string {
  const [mm, dd, yyyy] = dateKey.split('/').map(Number)
  const [h, m] = slotTime.split(':').map(Number)
  return new Date(Date.UTC(yyyy, mm - 1, dd, h + 6, m, 0, 0)).toISOString()
}
function nextDateKey(dateKey: string): string {
  const [mm, dd, yyyy] = dateKey.split('/').map(Number)
  const d = new Date(yyyy, mm - 1, dd + 1)
  return (d.getMonth() + 1).toString().padStart(2, '0') + '/' + d.getDate().toString().padStart(2, '0') + '/' + d.getFullYear()
}
function findNextAvailableSlot(startDateKey: string): { dateKey: string, slot: string } | null {
  let dateKey = startDateKey
  for (let i = 0; i < 30; i++) {
    for (const slot of uniqueSlots) {
      const key = dateKey + '|' + slot
      if (!taken.has(key)) return { dateKey, slot }
    }
    dateKey = nextDateKey(dateKey)
  }
  return null
}

for (const post of posts) {
  const dateKey = getDateKey(post.scheduledFor)
  const timeKey = getTimeKey(post.scheduledFor)
  const currentKey = dateKey + '|' + timeKey

  if (uniqueSlots.includes(timeKey) && !taken.has(currentKey)) {
    taken.add(currentKey)
    continue
  }

  const next = findNextAvailableSlot(dateKey)
  if (!next) { console.log('ERROR: no slot for', post._id); continue }

  taken.add(next.dateKey + '|' + next.slot)
  reschedules.push({
    id: post._id,
    old: dateKey.substring(0,5) + ' ' + timeKey,
    newISO: buildISO(next.dateKey, next.slot),
    newDisplay: next.dateKey.substring(0,5) + ' ' + next.slot
  })
}

console.log('\nReschedules:', reschedules.length)
for (const r of reschedules) console.log('  ', r.id, r.old, '->', r.newDisplay)

console.log('\nExecuting...')
let ok = 0, fail = 0
for (const rs of reschedules) {
  const res = await fetch('https://getlate.dev/api/v1/posts/' + rs.id, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scheduledFor: rs.newISO })
  })
  if (res.ok) ok++; else { fail++; console.log('  FAIL', rs.id, res.status) }
}
console.log('Done:', ok, 'ok,', fail, 'failed')

// Verify
const v = await fetch('https://getlate.dev/api/v1/posts?platform=twitter&status=scheduled&limit=100', {
  headers: { 'Authorization': 'Bearer ' + k },
})
const vp = (await v.json()).posts || []
const byDay: Record<string, number> = {}
const byTime: Record<string, number> = {}
for (const p of vp) {
  const d = getDateKey(p.scheduledFor)
  const t = d + ' ' + getTimeKey(p.scheduledFor)
  byDay[d] = (byDay[d] || 0) + 1
  byTime[t] = (byTime[t] || 0) + 1
}
const cols = Object.entries(byTime).filter(([, c]) => c > 1)
console.log('\nCollisions:', cols.length)
console.log('Posts per day:')
for (const [d, c] of Object.entries(byDay).sort()) {
  console.log(' ', d + ':', c, c > 20 ? '⚠️ OVER' : '✓')
}
