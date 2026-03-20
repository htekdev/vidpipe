/**
 * L4-L6 Integration Test — ScheduleAgent tool registration
 *
 * Mock boundary: L2 (LateApiClient)
 * Real code:     L3 services, L4 ScheduleAgent
 *
 * Verifies ScheduleAgent registers expected tools and does not
 * register previously removed tools.
 */
import { vi, describe, test, expect } from 'vitest'

// ── Mock L2 ──────────────────────────────────────────────────────────

vi.mock('../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: vi.fn(),
}))

// ── Import after mocks ──────────────────────────────────────────────

import { ScheduleAgent } from '../../../L4-agents/ScheduleAgent.js'

// ── Tests ───────────────────────────────────────────────────────────

describe('L4-L6 Integration: ScheduleAgent', () => {
  test('registers only the remaining schedule tools', () => {
    const agent = new ScheduleAgent()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tools = (agent as any)['getTools']() as Array<{ name: string }>
      const toolNames = tools.map(t => t.name)

      expect(toolNames).toContain('list_posts')
      expect(toolNames).toContain('view_schedule_config')
      expect(toolNames).toContain('reschedule_post')
      expect(toolNames).toContain('cancel_post')
      expect(toolNames).toHaveLength(4)
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(agent as any).destroy?.()
    }
  })

  test('does not register removed tools (find_next_slot, realign_schedule, etc.)', () => {
    const agent = new ScheduleAgent()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tools = (agent as any)['getTools']() as Array<{ name: string }>
      const toolNames = tools.map(t => t.name)

      expect(toolNames).not.toContain('find_next_slot')
      expect(toolNames).not.toContain('realign_schedule')
      expect(toolNames).not.toContain('view_calendar')
      expect(toolNames).not.toContain('start_prioritize_realign')
      expect(toolNames).not.toContain('check_realign_status')
      expect(toolNames).not.toContain('smart_reschedule')
      expect(toolNames).not.toContain('sync_queues')
      expect(toolNames).not.toContain('build_queue')
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(agent as any).destroy?.()
    }
  })
})
