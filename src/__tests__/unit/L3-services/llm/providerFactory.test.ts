import { vi, describe, test, expect, afterEach } from 'vitest'

const mockGetProvider = vi.hoisted(() => vi.fn())
const mockResetProvider = vi.hoisted(() => vi.fn())
const mockGetProviderName = vi.hoisted(() => vi.fn())

vi.mock('../../../../L2-clients/llm/index.js', () => ({
  getProvider: mockGetProvider,
  resetProvider: mockResetProvider,
  getProviderName: mockGetProviderName,
}))

import { getProvider, resetProvider, getProviderName } from '../../../../L3-services/llm/providerFactory.js'

describe('L3 providerFactory wrappers', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  test('getProvider delegates to L2 with name argument', () => {
    const fakeProvider = { name: 'openai' }
    mockGetProvider.mockReturnValue(fakeProvider)
    const result = getProvider('openai')
    expect(result).toBe(fakeProvider)
    expect(mockGetProvider).toHaveBeenCalledWith('openai')
  })

  test('getProvider delegates to L2 without name argument', () => {
    const fakeProvider = { name: 'copilot' }
    mockGetProvider.mockReturnValue(fakeProvider)
    const result = getProvider()
    expect(result).toBe(fakeProvider)
    expect(mockGetProvider).toHaveBeenCalledWith(undefined)
  })

  test('resetProvider delegates to L2', async () => {
    mockResetProvider.mockResolvedValue(undefined)
    await resetProvider()
    expect(mockResetProvider).toHaveBeenCalledOnce()
  })

  test('getProviderName delegates to L2', () => {
    mockGetProviderName.mockReturnValue('claude')
    const result = getProviderName()
    expect(result).toBe('claude')
    expect(mockGetProviderName).toHaveBeenCalledOnce()
  })
})
