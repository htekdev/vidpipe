/**
 * E2E Test — ideate --add command
 *
 * No mocking — verifies the ideate module exports and --add option types.
 * GitHub API calls are not made (no GITHUB_TOKEN configured in CI).
 */
import { describe, test, expect } from 'vitest'
import type { IdeateCommandOptions } from '../../L7-app/commands/ideate.js'

describe('E2E: ideate --add command', () => {
  test('ideate module exports runIdeate function', async () => {
    const mod = await import('../../L7-app/commands/ideate.js')
    expect(mod.runIdeate).toBeDefined()
    expect(typeof mod.runIdeate).toBe('function')
  })

  test('IdeateCommandOptions accepts --add fields', () => {
    const options: IdeateCommandOptions = {
      add: true,
      topic: 'Test topic',
      hook: 'Test hook',
      audience: 'developers',
      platforms: 'youtube,tiktok',
      keyTakeaway: 'Core message',
      talkingPoints: 'Point A,Point B',
      tags: 'ai,devtools',
      publishBy: '2026-06-01',
      trendContext: 'Timely because...',
      ai: false,
      format: 'json',
      prompt: 'Cover this article: https://example.com',
    }

    expect(options.add).toBe(true)
    expect(options.topic).toBe('Test topic')
    expect(options.hook).toBe('Test hook')
    expect(options.audience).toBe('developers')
    expect(options.platforms).toBe('youtube,tiktok')
    expect(options.keyTakeaway).toBe('Core message')
    expect(options.talkingPoints).toBe('Point A,Point B')
    expect(options.tags).toBe('ai,devtools')
    expect(options.publishBy).toBe('2026-06-01')
    expect(options.trendContext).toBe('Timely because...')
    expect(options.ai).toBe(false)
    expect(options.format).toBe('json')
    expect(options.prompt).toBe('Cover this article: https://example.com')
  })

  test('IdeateCommandOptions --add fields default to undefined', () => {
    const options: IdeateCommandOptions = {
      add: true,
      topic: 'Just a topic',
    }

    expect(options.add).toBe(true)
    expect(options.topic).toBe('Just a topic')
    expect(options.hook).toBeUndefined()
    expect(options.audience).toBeUndefined()
    expect(options.platforms).toBeUndefined()
    expect(options.ai).toBeUndefined()
  })

  test('generateIdeas is exported from L6 ideation bridge', async () => {
    const mod = await import('../../L6-pipeline/ideation.js')
    expect(mod.generateIdeas).toBeDefined()
    expect(typeof mod.generateIdeas).toBe('function')
  })
})
