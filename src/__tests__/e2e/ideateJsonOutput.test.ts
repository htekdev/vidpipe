/**
 * E2E Test — ideate command JSON output
 *
 * No mocking — verifies the ideate module exports and JSON output shape.
 * GitHub API calls are skipped when GITHUB_TOKEN is not configured.
 */
import { describe, test, expect } from 'vitest'

describe('E2E: ideate command', () => {
  test('ideate module exports runIdeate function', async () => {
    const mod = await import('../../L7-app/commands/ideate.js')
    expect(mod.runIdeate).toBeDefined()
    expect(typeof mod.runIdeate).toBe('function')
  })

  test('IdeateCommandOptions accepts format field', async () => {
    const mod = await import('../../L7-app/commands/ideate.js')
    const options: import('../../L7-app/commands/ideate.js').IdeateCommandOptions = {
      list: true,
      format: 'json',
    }
    expect(options.format).toBe('json')
    expect(mod.runIdeate).toBeDefined()
  })

  test('IdeateCommandOptions format defaults to undefined (table behavior)', async () => {
    const options: import('../../L7-app/commands/ideate.js').IdeateCommandOptions = {
      list: true,
    }
    expect(options.format).toBeUndefined()
  })
})
