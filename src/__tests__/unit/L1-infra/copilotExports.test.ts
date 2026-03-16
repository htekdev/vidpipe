/**
 * L1 Unit Test — copilot.ts re-exports from @github/copilot-sdk
 *
 * Validates that the L1 wrapper re-exports CopilotClient, CopilotSession,
 * and approveAll from the SDK (mocked globally in setup.ts).
 */
import { describe, test, expect } from 'vitest'

import { CopilotClient, CopilotSession, approveAll } from '../../../L1-infra/ai/copilot.js'

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
