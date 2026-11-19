import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface Resource {
  Type: string
  DeletionPolicy?: string
  UpdateReplacePolicy?: string
  Properties: Record<string, unknown>
}
interface Template {
  Resources: Record<string, Resource>
  Outputs: Record<string, { Description: string; Value: unknown }>
  Parameters: Record<string, { Default?: string; AllowedPattern?: string }>
}
interface Statement {
  Effect: string
  Action: string | string[]
  Resource: unknown
  Condition?: unknown
}
interface TableProperties {
  AttributeDefinitions: Array<{ AttributeName: string; AttributeType: string }>
  KeySchema: Array<{ AttributeName: string; KeyType: string }>
  GlobalSecondaryIndexes: Array<{
    IndexName: string
    KeySchema: Array<{ AttributeName: string; KeyType: string }>
    Projection: { ProjectionType: string }
  }>
}

function loadTemplate(): Template {
  return parse(readFileSync(resolve(import.meta.dirname, '..', '..', '..', '..', 'infra', 'aws', 'storage.yaml'), 'utf8')) as Template
}

function keys(hash: string, range?: string): Array<{ AttributeName: string; KeyType: string }> {
  return [
    { AttributeName: hash, KeyType: 'HASH' },
    ...(range ? [{ AttributeName: range, KeyType: 'RANGE' }] : []),
  ]
}

// Evaluate the small set of CloudFormation intrinsics used by this template to
// verify both empty and non-empty namespace permissions, not just YAML shape.
function evaluate(value: unknown, prefix: string): unknown {
  const refs: Record<string, string> = {
    'AWS::Partition': 'aws', 'AWS::Region': 'us-west-2', 'AWS::AccountId': '123456789012',
    ObjectPrefix: prefix, StorageBucket: 'media-bucket', ContentTable: 'content-table', VideosTable: 'videos-table',
    'StorageBucket.Arn': 'arn:aws:s3:::media-bucket',
    'ContentTable.Arn': 'arn:aws:dynamodb:us-west-2:123456789012:table/content-table',
    'VideosTable.Arn': 'arn:aws:dynamodb:us-west-2:123456789012:table/videos-table',
    RuntimePolicy: 'arn:aws:iam::123456789012:policy/runtime',
  }
  if (Array.isArray(value)) return value.map((entry) => evaluate(entry, prefix))
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  if ('Ref' in record) {
    const ref = String(record.Ref)
    if (!(ref in refs)) throw new Error(`Unknown reference: ${ref}`)
    return refs[ref]
  }
  if ('Fn::GetAtt' in record) {
    const attribute = (record['Fn::GetAtt'] as string[]).join('.')
    if (!(attribute in refs)) throw new Error(`Unknown attribute: ${attribute}`)
    return refs[attribute]
  }
  if ('Fn::Sub' in record) {
    return String(record['Fn::Sub']).replace(/\$\{([^}]+)\}/g, (_, key: string) => {
      if (!(key in refs)) throw new Error(`Unknown substitution: ${key}`)
      return refs[key]
    })
  }
  if ('Fn::If' in record) {
    const [condition, yes, no] = record['Fn::If'] as unknown[]
    if (condition !== 'HasObjectPrefix') throw new Error(`Unknown condition: ${String(condition)}`)
    return evaluate(prefix ? yes : no, prefix)
  }
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, evaluate(entry, prefix)]))
}

describe('AWS CloudFormation storage contract', () => {
  it('storage.REQ-001: provides the exact content and video query schemas with complete projections', () => {
    const { Resources } = loadTemplate()
    const content = Resources.ContentTable.Properties as unknown as TableProperties
    const videos = Resources.VideosTable.Properties as unknown as TableProperties
    expect(content.KeySchema).toEqual(keys('itemId', 'videoSlug'))
    expect(content.GlobalSecondaryIndexes).toEqual([
      { IndexName: 'status-createdAt-index', KeySchema: keys('status', 'statusSortKey'), Projection: { ProjectionType: 'ALL' } },
      { IndexName: 'videoSlug-itemId-index', KeySchema: keys('videoSlug', 'itemId'), Projection: { ProjectionType: 'ALL' } },
    ])
    expect(videos.KeySchema).toEqual(keys('runId'))
    expect(videos.GlobalSecondaryIndexes).toEqual([
      { IndexName: 'status-createdAt-index', KeySchema: keys('status', 'createdAt'), Projection: { ProjectionType: 'ALL' } },
    ])
    for (const table of [content, videos]) {
      const keyNames = new Set([
        ...table.KeySchema.map((key) => key.AttributeName),
        ...table.GlobalSecondaryIndexes.flatMap((index) => index.KeySchema.map((key) => key.AttributeName)),
      ])
      expect(new Set(table.AttributeDefinitions.map((attr) => attr.AttributeName))).toEqual(keyNames)
      expect(table.AttributeDefinitions.every((attr) => attr.AttributeType === 'S')).toBe(true)
    }
  })

  it('storage.REQ-002: protects persistent resources without expiring completed objects', () => {
    const { Resources } = loadTemplate()
    for (const name of ['StorageBucket', 'ContentTable', 'VideosTable']) {
      expect(Resources[name]).toMatchObject({ DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' })
    }
    for (const name of ['ContentTable', 'VideosTable']) {
      expect(Resources[name].Properties).toMatchObject({
        BillingMode: 'PAY_PER_REQUEST',
        SSESpecification: { SSEEnabled: true },
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      })
    }
    expect(Resources.StorageBucket.Properties).toMatchObject({
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true,
      },
      BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
      VersioningConfiguration: { Status: 'Enabled' },
    })
    const lifecycle = evaluate(Resources.StorageBucket.Properties.LifecycleConfiguration, 'team/media')
    expect(lifecycle).toEqual({
      Rules: [{ Id: 'AbortAbandonedUploads', Status: 'Enabled', Prefix: 'team/media/', AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 } }],
    })
    const bucketPolicy = evaluate(Resources.StorageBucketPolicy.Properties.PolicyDocument, '') as { Statement: Statement[] }
    expect(bucketPolicy.Statement).toContainEqual({
      Sid: 'DenyInsecureTransport', Effect: 'Deny', Principal: '*', Action: 's3:*',
      Resource: ['arn:aws:s3:::media-bucket', 'arn:aws:s3:::media-bucket/*'],
      Condition: { Bool: { 'aws:SecureTransport': 'false' } },
    })
  })

  it.each(['', 'team/media'])('storage.REQ-003: scopes runtime grants for prefix "%s" without creating principals or credentials', (prefix) => {
    const { Resources } = loadTemplate()
    expect(Object.values(Resources).map((resource) => resource.Type).sort()).toEqual([
      'AWS::DynamoDB::Table', 'AWS::DynamoDB::Table', 'AWS::IAM::ManagedPolicy', 'AWS::S3::Bucket', 'AWS::S3::BucketPolicy',
    ])
    expect(Resources.RuntimePolicy.Properties).not.toHaveProperty('Users')
    expect(Resources.RuntimePolicy.Properties).not.toHaveProperty('Roles')
    const policy = evaluate(Resources.RuntimePolicy.Properties.PolicyDocument, prefix) as { Statement: Statement[] }
    for (const statement of policy.Statement) {
      expect(statement.Effect).toBe('Allow')
      expect(Array.isArray(statement.Action)).toBe(true)
      expect((statement.Action as string[]).every((action) => !action.includes('*'))).toBe(true)
      expect([statement.Resource].flat()).not.toContain('*')
    }
    const objects = policy.Statement.find((statement) => statement.Action.includes('s3:PutObject'))
    expect(objects?.Action).toEqual(expect.arrayContaining([
      's3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts',
    ]))
    expect(objects?.Resource).toBe(`arn:aws:s3:::media-bucket/${prefix ? `${prefix}/` : ''}*`)
    const listing = policy.Statement.find((statement) => statement.Action.includes('s3:ListBucket'))
    expect(listing?.Resource).toBe('arn:aws:s3:::media-bucket')
    expect(listing?.Condition).toEqual({
      StringLike: { 's3:prefix': prefix ? [prefix, `${prefix}/*`] : ['*'] },
    })
    const dynamo = policy.Statement.filter((statement) => (statement.Action as string[]).some((action) => action.startsWith('dynamodb:')))
    expect(dynamo.flatMap((statement) => statement.Action)).toEqual(expect.arrayContaining([
      'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:DescribeTable',
    ]))
    const resources = dynamo.flatMap((statement) => [statement.Resource].flat() as string[])
    expect(new Set(resources)).toEqual(new Set([
      'arn:aws:dynamodb:us-west-2:123456789012:table/content-table',
      'arn:aws:dynamodb:us-west-2:123456789012:table/videos-table',
      'arn:aws:dynamodb:us-west-2:123456789012:table/content-table/index/status-createdAt-index',
      'arn:aws:dynamodb:us-west-2:123456789012:table/content-table/index/videoSlug-itemId-index',
      'arn:aws:dynamodb:us-west-2:123456789012:table/videos-table/index/status-createdAt-index',
    ]))
  })

  it.each(['', 'team/media'])('storage.REQ-004: outputs application settings and applies optional safe prefix "%s" consistently', (prefix) => {
    const template = loadTemplate()
    expect(template.Parameters.ObjectPrefix.Default).toBe('')
    const pattern = new RegExp(template.Parameters.ObjectPrefix.AllowedPattern!)
    expect(pattern.test(prefix)).toBe(true)
    for (const invalid of ['*', '../', '/team', 'team/', 'team?']) expect(pattern.test(invalid)).toBe(false)
    for (const logicalId of Object.keys(template.Outputs)) expect(logicalId).toMatch(/^[a-zA-Z0-9]+$/)
    const outputs = Object.fromEntries(Object.values(template.Outputs).map((output) => [output.Description, evaluate(output.Value, prefix)]))
    expect(outputs).toEqual({
      STORAGE_PROVIDER: 'aws', AWS_REGION: 'us-west-2', AWS_S3_BUCKET: 'media-bucket', AWS_S3_PREFIX: prefix,
      AWS_DYNAMODB_CONTENT_TABLE: 'content-table', AWS_DYNAMODB_VIDEOS_TABLE: 'videos-table',
      RuntimePolicyArn: 'arn:aws:iam::123456789012:policy/runtime',
    })
    const lifecycle = evaluate(template.Resources.StorageBucket.Properties.LifecycleConfiguration, prefix)
    expect(lifecycle).toMatchObject({ Rules: [{ Prefix: prefix ? `${prefix}/` : '' }] })
  })
})
