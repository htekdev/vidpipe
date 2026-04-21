/**
 * E2E Test — agenda and discover-ideas command exports + schedule config
 *
 * No mocking — verifies module exports and schedule config structure.
 */
import { describe, test, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

describe('E2E: agenda and discover-ideas commands', () => {
  test('agenda module exports runAgenda function', async () => {
    const mod = await import('../../L7-app/commands/agenda.js')
    expect(mod.runAgenda).toBeDefined()
    expect(typeof mod.runAgenda).toBe('function')
  })

  test('AgendaCommandOptions accepts output field', async () => {
    const mod = await import('../../L7-app/commands/agenda.js')
    const options: import('../../L7-app/commands/agenda.js').AgendaCommandOptions = {
      output: 'custom-agenda.md',
    }
    expect(options.output).toBe('custom-agenda.md')
    expect(mod.runAgenda).toBeDefined()
  })

  test('discover-ideas module exports runDiscoverIdeas function', async () => {
    const mod = await import('../../L7-app/commands/discoverIdeas.js')
    expect(mod.runDiscoverIdeas).toBeDefined()
    expect(typeof mod.runDiscoverIdeas).toBe('function')
  })

  test('DiscoverIdeasCommandOptions supports publishBy and dryRun', async () => {
    const mod = await import('../../L7-app/commands/discoverIdeas.js')
    const options: import('../../L7-app/commands/discoverIdeas.js').DiscoverIdeasCommandOptions = {
      publishBy: '2026-04-01',
      dryRun: true,
    }
    expect(options.publishBy).toBe('2026-04-01')
    expect(options.dryRun).toBe(true)
    expect(mod.runDiscoverIdeas).toBeDefined()
  })

  test('schedule.json has displacement and ideaSpacing config for publishBy enforcement', async () => {
    const configPath = resolve(process.cwd(), 'schedule.json')
    const raw = await readFile(configPath, 'utf8')
    const config = JSON.parse(raw) as Record<string, unknown>

    expect(config.timezone).toBe('America/Chicago')
    expect(config.displacement).toEqual(expect.objectContaining({
      enabled: true,
      canDisplace: 'non-idea-only',
    }))
    expect(config.ideaSpacing).toEqual(expect.objectContaining({
      samePlatformHours: 6,
      crossPlatformHours: 0,
    }))
  })
})
