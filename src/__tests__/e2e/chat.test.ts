/**
 * E2E Test — chat command exports
 *
 * No mocking — verifies chat module is importable and exports runChat.
 */
import { describe, test, expect } from 'vitest'

describe('E2E: chat command', () => {
  test('chat module exports runChat function', async () => {
    const mod = await import('../../L7-app/commands/chat.js')
    expect(mod.runChat).toBeDefined()
    expect(typeof mod.runChat).toBe('function')
  })
})
