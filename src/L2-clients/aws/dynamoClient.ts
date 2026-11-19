import { getConfig } from '../../L1-infra/config/environment.js'
import { DynamoDBClient, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '../../L1-infra/aws/awsSdk.js'
import type { QueryCommandInput, ScanCommandInput } from '../../L1-infra/aws/awsSdk.js'

type Item = Record<string, unknown>

function client(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region: getConfig().AWS_REGION }), {
    marshallOptions: { removeUndefinedValues: true },
  })
}

/** Reject before network I/O, leaving headroom below DynamoDB's 400 KiB item limit. */
export function validateMetadata(item: Item): void {
  if (Buffer.byteLength(JSON.stringify(item), 'utf8') > 390 * 1024) {
    throw new Error('DynamoDB metadata exceeds 390 KiB; shorten post content or metadata. Original metadata remains in S3.')
  }
}

/** Read authoritative base-table state. */
export async function getItem(table: string, key: Item): Promise<Item | null> {
  const result = await client().send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true }))
  return result.Item ?? null
}

/** Create without replacing an existing complete identity. */
export async function createItem(table: string, item: Item, keyName = 'itemId'): Promise<boolean> {
  validateMetadata(item)
  try {
    await client().send(new PutCommand({
      TableName: table, Item: item,
      ConditionExpression: 'attribute_not_exists(#key)',
      ExpressionAttributeNames: { '#key': keyName },
    }))
    return true
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false
    throw error
  }
}

/** Update only an existing identity; optional expected status prevents stale mutations. */
export async function updateItem(table: string, key: Item, fields: Item, expectedStatus?: string): Promise<void> {
  validateMetadata({ ...key, ...fields })
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined)
  if (!entries.length) return
  const names: Record<string, string> = { '#key': Object.keys(key)[0] }
  const values: Item = {}
  const updates = entries.map(([name, value], index) => {
    names[`#f${index}`] = name
    values[`:v${index}`] = value
    return `#f${index} = :v${index}`
  })
  let condition = 'attribute_exists(#key)'
  if (expectedStatus !== undefined) {
    names['#expectedStatus'] = 'status'
    values[':expectedStatus'] = expectedStatus
    condition += ' AND #expectedStatus = :expectedStatus'
  }
  await client().send(new UpdateCommand({
    TableName: table, Key: key, UpdateExpression: `SET ${updates.join(', ')}`,
    ConditionExpression: condition, ExpressionAttributeNames: names, ExpressionAttributeValues: values,
  }))
}

/** Atomically increment an existing numeric attribute without creating partial records. */
export async function incrementCounter(table: string, key: Item, name: string, amount: number): Promise<void> {
  await client().send(new UpdateCommand({
    TableName: table, Key: key, UpdateExpression: 'ADD #counter :amount',
    ConditionExpression: 'attribute_exists(#key)',
    ExpressionAttributeNames: { '#key': Object.keys(key)[0], '#counter': name },
    ExpressionAttributeValues: { ':amount': amount },
  }))
}

/** Consume all query pages, including empty filtered pages with a continuation key. */
export async function queryAll(input: QueryCommandInput): Promise<Item[]> {
  const db = client()
  const items: Item[] = []
  let cursor: QueryCommandInput['ExclusiveStartKey']
  do {
    const result = await db.send(new QueryCommand({ ...input, ConsistentRead: input.IndexName ? false : true, ExclusiveStartKey: cursor }))
    items.push(...(result.Items ?? []))
    cursor = result.LastEvaluatedKey
  } while (cursor && Object.keys(cursor).length)
  return items
}

/** Administrative unfiltered listing; hot lookups must use queryAll/getItem. */
export async function scanAll(input: ScanCommandInput): Promise<Item[]> {
  const db = client()
  const items: Item[] = []
  let cursor: ScanCommandInput['ExclusiveStartKey']
  do {
    const result = await db.send(new ScanCommand({ ...input, ExclusiveStartKey: cursor }))
    items.push(...(result.Items ?? []))
    cursor = result.LastEvaluatedKey
  } while (cursor && Object.keys(cursor).length)
  return items
}
