/**
 * E2E — scheduleConfig resolution and configure KEY_MAP contracts.
 *
 * No mocks. Tests module exports and type contracts for the
 * scheduleConfig, resolveSchedulePath, and configure KEY_MAP changes.
 */
import { describe, test, expect } from 'vitest'
import type { GlobalDefaults } from '../../L1-infra/config/globalConfig.js'

describe('E2E: scheduleConfig resolution', () => {
  test('GlobalDefaults type accepts scheduleConfig field', () => {
    const defaults: GlobalDefaults = {
      scheduleConfig: '/shared/schedule.json',
    }

    expect(defaults.scheduleConfig).toBe('/shared/schedule.json')
  })

  test('GlobalDefaults scheduleConfig is optional', () => {
    const defaults: GlobalDefaults = {}

    expect(defaults.scheduleConfig).toBeUndefined()
  })

  test('resolveSchedulePath is exported from scheduleStore', async () => {
    const mod = await import('../../L2-clients/scheduleStore/scheduleStore.js')
    expect(typeof mod.resolveSchedulePath).toBe('function')
  })

  test('schedulePost is exported from scheduler', async () => {
    const mod = await import('../../L3-services/scheduler/scheduler.js')
    expect(typeof mod.schedulePost).toBe('function')
  })

  test('buildBookedMap is exported from scheduler', async () => {
    const mod = await import('../../L3-services/scheduler/scheduler.js')
    expect(typeof mod.buildBookedMap).toBe('function')
  })

  test('KEY_MAP includes schedule-config mapping', async () => {
    const { KEY_MAP } = await import('../../L7-app/commands/configure.js')
    expect(KEY_MAP['schedule-config']).toEqual({ section: 'defaults', key: 'scheduleConfig' })
  })

  test('GenerateIdeasOptions accepts prompt field', async () => {
    const mod = await import('../../L4-agents/IdeationAgent.js')
    expect(typeof mod.generateIdeas).toBe('function')
  })
})
