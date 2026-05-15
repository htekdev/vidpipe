import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockCreateEntity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockUpsertEntity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockGetEntity = vi.hoisted(() => vi.fn().mockResolvedValue({ partitionKey: 'pk', rowKey: 'rk', name: 'test' }))
const mockUpdateEntity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockDeleteEntity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockCreateTable = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockGetConfig = vi.hoisted(() => vi.fn().mockReturnValue({
  AZURE_STORAGE_ACCOUNT_NAME: 'testaccount',
  AZURE_STORAGE_ACCOUNT_KEY: 'dGVzdGtleQ==',
}))

vi.mock('@azure/data-tables', () => {
  class MockAzureNamedKeyCredential {}
  class MockTableClient {
    createEntity = mockCreateEntity
    upsertEntity = mockUpsertEntity
    getEntity = mockGetEntity
    updateEntity = mockUpdateEntity
    deleteEntity = mockDeleteEntity
    createTable = mockCreateTable
    listEntities() {
      return {
        [Symbol.asyncIterator]: async function*() {
          yield { partitionKey: 'pk', rowKey: 'rk1', name: 'item1' }
          yield { partitionKey: 'pk', rowKey: 'rk2', name: 'item2' }
        },
      }
    }
  }
  return {
    AzureNamedKeyCredential: MockAzureNamedKeyCredential,
    TableClient: MockTableClient,
  }
})

vi.mock('../../../../L1-infra/config/environment.js', () => ({
  getConfig: mockGetConfig,
}))

async function loadModule() {
  return import('../../../../L2-clients/azure/tableClient.js')
}

describe('L2 Unit: Azure Table Client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue({
      AZURE_STORAGE_ACCOUNT_NAME: 'testaccount',
      AZURE_STORAGE_ACCOUNT_KEY: 'dGVzdGtleQ==',
    })
  })

  test('createEntity calls Azure SDK createEntity', async () => {
    const { createEntity } = await loadModule()
    await createEntity('TestTable', 'pk', 'rk', { name: 'test' })
    expect(mockCreateEntity).toHaveBeenCalledWith({ partitionKey: 'pk', rowKey: 'rk', name: 'test' })
  })

  test('upsertEntity calls Azure SDK upsertEntity with Merge', async () => {
    const { upsertEntity } = await loadModule()
    await upsertEntity('TestTable', 'pk', 'rk', { name: 'test' })
    expect(mockUpsertEntity).toHaveBeenCalledWith({ partitionKey: 'pk', rowKey: 'rk', name: 'test' }, 'Merge')
  })

  test('getEntity returns entity when found', async () => {
    const { getEntity } = await loadModule()
    const result = await getEntity('TestTable', 'pk', 'rk')
    expect(result).toEqual({ partitionKey: 'pk', rowKey: 'rk', name: 'test' })
  })

  test('getEntity returns null for 404', async () => {
    mockGetEntity.mockRejectedValueOnce(Object.assign(new Error('Not found'), { statusCode: 404 }))
    const { getEntity } = await loadModule()
    const result = await getEntity('TestTable', 'pk', 'rk')
    expect(result).toBeNull()
  })

  test('getEntity rethrows non-404 errors', async () => {
    mockGetEntity.mockRejectedValueOnce(Object.assign(new Error('Server error'), { statusCode: 500 }))
    const { getEntity } = await loadModule()
    await expect(getEntity('TestTable', 'pk', 'rk')).rejects.toThrow('Server error')
  })

  test('queryEntities returns all matching entities', async () => {
    const { queryEntities } = await loadModule()
    const results = await queryEntities('TestTable', "PartitionKey eq 'pk'")
    expect(results).toHaveLength(2)
    expect(results[0].rowKey).toBe('rk1')
  })

  test('updateEntity calls Azure SDK updateEntity with Merge', async () => {
    const { updateEntity } = await loadModule()
    await updateEntity('TestTable', 'pk', 'rk', { status: 'approved' })
    expect(mockUpdateEntity).toHaveBeenCalledWith(
      { partitionKey: 'pk', rowKey: 'rk', status: 'approved' },
      'Merge',
    )
  })

  test('deleteEntity calls Azure SDK deleteEntity', async () => {
    const { deleteEntity } = await loadModule()
    await deleteEntity('TestTable', 'pk', 'rk')
    expect(mockDeleteEntity).toHaveBeenCalledWith('pk', 'rk')
  })

  test('deleteEntity swallows 404 (already deleted)', async () => {
    mockDeleteEntity.mockRejectedValueOnce(Object.assign(new Error('Not found'), { statusCode: 404 }))
    const { deleteEntity } = await loadModule()
    await expect(deleteEntity('TestTable', 'pk', 'rk')).resolves.toBeUndefined()
  })

  test('deleteEntity rethrows non-404 errors', async () => {
    mockDeleteEntity.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { statusCode: 403 }))
    const { deleteEntity } = await loadModule()
    await expect(deleteEntity('TestTable', 'pk', 'rk')).rejects.toThrow('Forbidden')
  })

  test('ensureTable creates table successfully', async () => {
    const { ensureTable } = await loadModule()
    await expect(ensureTable('NewTable')).resolves.toBeUndefined()
    expect(mockCreateTable).toHaveBeenCalledOnce()
  })

  test('ensureTable swallows 409 (table exists)', async () => {
    mockCreateTable.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { statusCode: 409 }))
    const { ensureTable } = await loadModule()
    await expect(ensureTable('TestTable')).resolves.toBeUndefined()
  })

  test('ensureTable rethrows non-409 errors', async () => {
    mockCreateTable.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { statusCode: 401 }))
    const { ensureTable } = await loadModule()
    await expect(ensureTable('TestTable')).rejects.toThrow('Unauthorized')
  })

  test('getTableClient throws when credentials are missing', async () => {
    mockGetConfig.mockReturnValueOnce({
      AZURE_STORAGE_ACCOUNT_NAME: '',
      AZURE_STORAGE_ACCOUNT_KEY: '',
    })
    const { createEntity } = await loadModule()
    await expect(createEntity('TestTable', 'pk', 'rk', {})).rejects.toThrow(
      'Azure Storage credentials not configured',
    )
  })
})
