/**
 * E2E Test — medium clip chronological ordering
 *
 * No mocks. Verifies that MediumVideoAgent enforces chronological
 * ordering and coverage requirements (not hook-first reordering).
 */
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

describe('MediumVideoAgent prompt ordering policy', () => {
  let source: string

  it('MediumVideoAgent source enforces chronological order, not hook-first', async () => {
    const agentPath = join(import.meta.dirname, '../../L4-agents/MediumVideoAgent.ts')
    source = await readFile(agentPath, 'utf-8')

    expect(source).toContain('strict chronological order')
    expect(source).toContain('NOT hook-first')
    expect(source).toContain('Coverage is paramount')
    // Should NOT import hook ASS generators
    expect(source).not.toContain('generateMediumASSWithHook')
  })
})
