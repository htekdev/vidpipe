/**
 * Cleanup script — removes duplicate content from Azure Table and Late API.
 *
 * What it does:
 * 1. Azure Table: finds duplicate rowKeys across partitions, keeps newest, deletes rest
 * 2. Late API: finds scheduled posts with duplicate content, keeps earliest-scheduled, deletes rest
 *
 * Run with: npx tsx scripts/cleanup-duplicates.ts [--dry-run]
 */
import { initConfig, getConfig } from '../src/L1-infra/config/environment.js'
import * as tableClient from '../src/L2-clients/azure/tableClient.js'
import { LateApiClient } from '../src/L2-clients/late/lateApi.js'

initConfig({})
const config = getConfig()
const dryRun = process.argv.includes('--dry-run')

if (dryRun) console.log('🔍 DRY RUN — no changes will be made\n')

// ── Azure Table cleanup ──────────────────────────────────────────────────

async function cleanupAzureTable(): Promise<void> {
  console.log('═══ Azure Table: Content ═══\n')

  const allItems = await tableClient.queryEntities<Record<string, unknown>>('Content', '')
  console.log(`Total items in Content table: ${allItems.length}`)

  // Group by rowKey — find duplicates across partitions
  const byRowKey = new Map<string, Array<{ partitionKey: string; rowKey: string; createdAt: string; status: string }>>()
  for (const item of allItems) {
    const key = item.rowKey as string
    if (!byRowKey.has(key)) byRowKey.set(key, [])
    byRowKey.get(key)!.push({
      partitionKey: item.partitionKey as string,
      rowKey: key,
      createdAt: String((item as Record<string, unknown>).createdAt || ''),
      status: String((item as Record<string, unknown>).status || ''),
    })
  }

  const duplicates = [...byRowKey].filter(([, items]) => items.length > 1)
  console.log(`Duplicate rowKeys: ${duplicates.length}`)

  let deleted = 0
  for (const [rowKey, items] of duplicates) {
    // Sort by createdAt descending — keep newest
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const keep = items[0]
    const toDelete = items.slice(1)

    console.log(`  ${rowKey}: ${items.length} copies → keeping ${keep.partitionKey} (${keep.createdAt})`)
    for (const dup of toDelete) {
      console.log(`    DELETE ${dup.partitionKey}/${dup.rowKey} (${dup.createdAt})`)
      if (!dryRun) {
        try {
          await tableClient.deleteEntity('Content', dup.partitionKey, dup.rowKey)
          deleted++
        } catch (err: unknown) {
          console.error(`    ERROR: ${err instanceof Error ? err.message : String(err)}`)
        }
      } else {
        deleted++
      }
    }
  }

  console.log(`\nAzure Table: ${deleted} duplicate(s) ${dryRun ? 'would be' : ''} deleted\n`)
}

// ── Late API cleanup ─────────────────────────────────────────────────────

async function cleanupLateApi(): Promise<void> {
  console.log('═══ Late API: Scheduled Posts ═══\n')

  const client = new LateApiClient(config.LATE_API_KEY)
  const allPosts = await client.getScheduledPosts()
  console.log(`Total scheduled posts: ${allPosts.length}`)

  // Group posts by content hash (first 200 chars of content)
  const byContent = new Map<string, Array<typeof allPosts[number]>>()
  for (const post of allPosts) {
    const contentKey = (post.content || '').slice(0, 200).trim().toLowerCase()
    if (!contentKey) continue
    if (!byContent.has(contentKey)) byContent.set(contentKey, [])
    byContent.get(contentKey)!.push(post)
  }

  const duplicates = [...byContent].filter(([, posts]) => posts.length > 1)
  console.log(`Duplicate content groups: ${duplicates.length}`)

  let deleted = 0
  for (const [, posts] of duplicates) {
    // Sort by scheduledFor ascending — keep earliest scheduled
    posts.sort((a, b) => (a.scheduledFor || '').localeCompare(b.scheduledFor || ''))
    const keep = posts[0]
    const toDelete = posts.slice(1)

    const preview = (keep.content || '').split('\n')[0]?.slice(0, 60) ?? ''
    console.log(`  "${preview}...": ${posts.length} copies → keeping ${keep._id} (${keep.scheduledFor?.slice(0, 10)})`)

    for (const dup of toDelete) {
      console.log(`    DELETE ${dup._id} (${dup.scheduledFor?.slice(0, 10)})`)
      if (!dryRun) {
        try {
          await client.deletePost(dup._id)
          deleted++
          await new Promise(r => setTimeout(r, 200)) // rate limit
        } catch (err: unknown) {
          console.error(`    ERROR: ${err instanceof Error ? err.message : String(err)}`)
        }
      } else {
        deleted++
      }
    }
  }

  console.log(`\nLate API: ${deleted} duplicate(s) ${dryRun ? 'would be' : ''} deleted\n`)
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await cleanupAzureTable()
  await cleanupLateApi()
  console.log('✅ Cleanup complete')
}

main().catch(err => {
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
