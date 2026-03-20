import { syncQueuesToLate, type SyncPlan } from '../../L3-services/scheduler/queueSync.js'
import logger from '../../L1-infra/logger/configLogger.js'

export interface SyncQueuesOptions {
  dryRun?: boolean
  reshuffle?: boolean
}

function formatPlan(plan: SyncPlan): string {
  const lines: string[] = []

  if (plan.toCreate.length > 0) {
    lines.push('\n  📦 Queues to CREATE:')
    for (const item of plan.toCreate) {
      lines.push(`     + ${item.name} (${item.platform}/${item.clipType}) — ${item.slots.length} slots`)
    }
  }

  if (plan.toUpdate.length > 0) {
    lines.push('\n  🔄 Queues to UPDATE:')
    for (const item of plan.toUpdate) {
      lines.push(`     ~ ${item.name} — ${item.currentSlots.length} → ${item.slots.length} slots`)
    }
  }

  if (plan.unchanged.length > 0) {
    lines.push(`\n  ✅ ${plan.unchanged.length} queue(s) unchanged`)
  }

  if (plan.toDelete.length > 0) {
    lines.push('\n  🗑️  Queues no longer in schedule.json (not auto-deleted):')
    for (const item of plan.toDelete) {
      lines.push(`     - ${item.name}`)
    }
  }

  return lines.join('\n')
}

export async function runSyncQueues(options: SyncQueuesOptions = {}): Promise<void> {
  logger.info('Syncing schedule.json → Late API queues...')

  try {
    const { plan, result } = await syncQueuesToLate({
      dryRun: options.dryRun,
      reshuffleExisting: options.reshuffle,
    })

    console.log(formatPlan(plan))

    if (options.dryRun) {
      console.log('\n  [DRY RUN] No changes applied. Remove --dry-run to execute.\n')
      return
    }

    if (result) {
      const parts: string[] = []
      if (result.created > 0) parts.push(`${result.created} created`)
      if (result.updated > 0) parts.push(`${result.updated} updated`)
      if (result.unchanged > 0) parts.push(`${result.unchanged} unchanged`)
      if (result.errors.length > 0) parts.push(`${result.errors.length} failed`)

      console.log(`\n  Result: ${parts.join(', ')}`)

      if (result.errors.length > 0) {
        console.log('\n  Errors:')
        for (const err of result.errors) {
          console.log(`    ✗ ${err.name}: ${err.error}`)
        }
      }
      console.log()
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`Queue sync failed: ${msg}`)
    console.error(`\n  ✗ Queue sync failed: ${msg}\n`)
    process.exitCode = 1
  }
}
