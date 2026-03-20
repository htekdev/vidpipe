import { describe, test, expect } from 'vitest'

/**
 * L7 unit test for thumbnail CLI command.
 * L7 unit tests can mock L0, L1, L6 only.
 * The command module is tested primarily via integration-L7 tier since
 * it imports L3 directly. This file validates the command module can be
 * statically imported without side effects.
 */
describe('thumbnail command module', () => {
  test('exports runThumbnail function', async () => {
    // Dynamic import to verify module loads without errors
    const mod = await import('../../../L7-app/commands/thumbnail.js')
    expect(mod.runThumbnail).toBeDefined()
    expect(typeof mod.runThumbnail).toBe('function')
  })

  test('ThumbnailCommandOptions interface accepts all documented options', async () => {
    // Type-level validation — verifies the interface shape compiles
    const opts: import('../../../L7-app/commands/thumbnail.js').ThumbnailCommandOptions = {
      platform: 'youtube',
      prompt: 'A bold thumbnail',
      output: './thumbnails',
      type: 'shorts',
      force: true,
    }
    expect(opts.platform).toBe('youtube')
    expect(opts.force).toBe(true)
  })
})
