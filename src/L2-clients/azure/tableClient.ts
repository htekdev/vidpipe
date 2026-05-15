import { TableClient as AzureTableClient, AzureNamedKeyCredential, type TableEntity, type TableEntityResult } from '@azure/data-tables'
import logger from '../../L1-infra/logger/configLogger.js'
import { getConfig } from '../../L1-infra/config/environment.js'

function getTableClient(tableName: string): AzureTableClient {
  const config = getConfig()
  const accountName = config.AZURE_STORAGE_ACCOUNT_NAME
  const accountKey = config.AZURE_STORAGE_ACCOUNT_KEY

  if (!accountName || !accountKey) {
    throw new Error('Azure Storage credentials not configured. Set AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY.')
  }

  const credential = new AzureNamedKeyCredential(accountName, accountKey)
  const url = `https://${accountName}.table.core.windows.net`

  return new AzureTableClient(url, tableName, credential)
}

export async function createEntity<T extends Record<string, unknown>>(
  tableName: string,
  partitionKey: string,
  rowKey: string,
  properties: T,
): Promise<void> {
  const client = getTableClient(tableName)
  const entity = { partitionKey, rowKey, ...properties }

  await client.createEntity(entity)
  logger.debug(`Created entity: ${tableName}/${partitionKey}/${rowKey}`)
}

export async function upsertEntity<T extends Record<string, unknown>>(
  tableName: string,
  partitionKey: string,
  rowKey: string,
  properties: T,
): Promise<void> {
  const client = getTableClient(tableName)
  const entity = { partitionKey, rowKey, ...properties }

  await client.upsertEntity(entity, 'Merge')
  logger.debug(`Upserted entity: ${tableName}/${partitionKey}/${rowKey}`)
}

export async function getEntity<T extends TableEntity>(
  tableName: string,
  partitionKey: string,
  rowKey: string,
): Promise<TableEntityResult<T> | null> {
  const client = getTableClient(tableName)

  try {
    return await client.getEntity<T>(partitionKey, rowKey) as TableEntityResult<T>
  } catch (error: unknown) {
    if (error instanceof Error && 'statusCode' in error && (error as Record<string, unknown>).statusCode === 404) {
      return null
    }
    throw error
  }
}

export async function queryEntities<T extends TableEntity>(
  tableName: string,
  filter: string,
): Promise<TableEntityResult<T>[]> {
  const client = getTableClient(tableName)
  const entities: TableEntityResult<T>[] = []

  for await (const entity of client.listEntities<T>({ queryOptions: { filter } })) {
    entities.push(entity as TableEntityResult<T>)
  }

  return entities
}

export async function updateEntity<T extends Record<string, unknown>>(
  tableName: string,
  partitionKey: string,
  rowKey: string,
  properties: T,
): Promise<void> {
  const client = getTableClient(tableName)
  const entity = { partitionKey, rowKey, ...properties }

  await client.updateEntity(entity, 'Merge')
  logger.debug(`Updated entity: ${tableName}/${partitionKey}/${rowKey}`)
}

export async function deleteEntity(
  tableName: string,
  partitionKey: string,
  rowKey: string,
): Promise<void> {
  const client = getTableClient(tableName)

  try {
    await client.deleteEntity(partitionKey, rowKey)
    logger.debug(`Deleted entity: ${tableName}/${partitionKey}/${rowKey}`)
  } catch (error: unknown) {
    if (error instanceof Error && 'statusCode' in error && (error as Record<string, unknown>).statusCode === 404) {
      logger.debug(`Entity not found (already deleted): ${tableName}/${partitionKey}/${rowKey}`)
      return
    }
    throw error
  }
}

export async function ensureTable(tableName: string): Promise<void> {
  const client = getTableClient(tableName)

  try {
    await client.createTable()
    logger.debug(`Created table: ${tableName}`)
  } catch (error: unknown) {
    if (error instanceof Error && 'statusCode' in error && (error as Record<string, unknown>).statusCode === 409) {
      // Table already exists — no-op
      return
    }
    throw error
  }
}
