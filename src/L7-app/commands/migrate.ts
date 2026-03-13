import { initConfig, getConfig } from '../../L1-infra/config/environment.js'
import { initializeDatabase } from '../../L1-infra/database/index.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { migrateJsonToSqlite, type MigrationResult } from '../../L3-services/migration/jsonToSqlite.js'

function logResult(result: MigrationResult): void {
  logger.info(`Videos: ${result.videosImported} imported, ${result.videosSkipped} skipped`)
  logger.info(`Pending queue items: ${result.queueItemsImported} imported, ${result.queueItemsSkipped} skipped`)
  logger.info(`Published items: ${result.publishedItemsImported} imported, ${result.publishedItemsSkipped} skipped`)

  if (result.errors.length === 0) {
    logger.info('Migration completed without errors')
    return
  }

  logger.warn(`Migration completed with ${result.errors.length} error(s)`)
  for (const error of result.errors) {
    logger.warn(`  • ${error}`)
  }
}

export async function runMigrate(): Promise<MigrationResult> {
  initConfig()
  initializeDatabase()

  const { OUTPUT_DIR } = getConfig()
  logger.info(`[Migration] Importing legacy JSON data from ${OUTPUT_DIR}`)

  const result = await migrateJsonToSqlite()
  logResult(result)
  return result
}
