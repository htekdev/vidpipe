/**
 * L1 Unit Test — copilot.ts re-exports from @github/copilot-sdk
 *
 * Validates that the L1 wrapper re-exports CopilotClient, CopilotSession,
 * and approveAll from the SDK (mocked globally in setup.ts).
 */
import { describe, test, expect, vi } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn((p: string) => p.includes('copilot.exe')),
}))

import { CopilotClient, CopilotSession, approveAll, resolveCopilotCliPath } from '../../../L1-infra/ai/copilot.js'

describe('L1 copilot.ts exports', () => {
  test('CopilotClient is re-exported', () => {
    expect(CopilotClient).toBeDefined()
  })

  test('CopilotSession is re-exported', () => {
    expect(CopilotSession).toBeDefined()
  })

  test('approveAll is re-exported as a function', () => {
    expect(approveAll).toBeDefined()
    expect(typeof approveAll).toBe('function')
  })
})

describe('resolveCopilotCliPath', () => {
  test('returns a string path when native binary exists', () => {
    const result = resolveCopilotCliPath()
    // With the mock returning true for paths containing 'copilot.exe',
    // on Windows this should find the binary
    if (process.platform === 'win32') {
      expect(result).toBeDefined()
      expect(result).toContain('copilot.exe')
    }
  })

  test('returns undefined when binary cannot be found', async () => {
    const { existsSync } = await import('node:fs')
    const mockExistsSync = vi.mocked(existsSync)
    mockExistsSync.mockReturnValue(false)

    const result = resolveCopilotCliPath()
    expect(result).toBeUndefined()

    // Restore for other tests
    mockExistsSync.mockImplementation((p: unknown) => String(p).includes('copilot.exe'))
  })
})
