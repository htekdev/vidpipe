import { initConfig } from '../../L1-infra/config/environment.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { syncQueuesToLate } from '../../L3-services/queueSync/queueSync.js'

export interface SyncQueuesOptions {
  reshuffle?: boolean
  dryRun?: boolean
  deleteOrphans?: boolean
}

export async function runSyncQueues(options: SyncQueuesOptions = {}): Promise<void> {
  initConfig()

  logger.info('Syncing schedule.json to Late API queues...')
  if (options.dryRun) logger.info('[DRY RUN] No changes will be made')

  const result = await syncQueuesToLate({
    reshuffle: options.reshuffle,
    dryRun: options.dryRun,
    deleteOrphans: options.deleteOrphans,
  })

  if (result.created.length > 0) {
    logger.info(`Created ${result.created.length} queues: ${result.created.join(', ')}`)
  }
  if (result.updated.length > 0) {
    logger.info(`Updated ${result.updated.length} queues: ${result.updated.join(', ')}`)
  }
  if (result.deleted.length > 0) {
    logger.info(`Deleted ${result.deleted.length} queues: ${result.deleted.join(', ')}`)
  }
  if (result.unchanged.length > 0) {
    logger.info(`Unchanged: ${result.unchanged.length} queues`)
  }
  if (result.errors.length > 0) {
    for (const err of result.errors) {
      logger.error(`Error syncing ${err.queueName}: ${err.error}`)
    }
  }

  const total = result.created.length + result.updated.length + result.deleted.length + result.unchanged.length
  logger.info(`Sync complete: ${total} queues processed`)
}
