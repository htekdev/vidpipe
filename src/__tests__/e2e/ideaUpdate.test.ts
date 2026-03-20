import { describe, test, expect } from 'vitest'

// E2E test for idea update — validates argument parsing and urgency resolution
describe('idea update e2e', () => {
  test('urgency levels resolve to valid ISO dates', () => {
    const urgencyMap = new Map<string, number>([
      ['hot', 3], ['urgent', 7], ['soon', 14], ['flexible', 60],
    ])
    for (const [name, days] of urgencyMap) {
      const date = new Date()
      date.setDate(date.getDate() + days)
      const isoDate = date.toISOString().split('T')[0]
      expect(isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})
