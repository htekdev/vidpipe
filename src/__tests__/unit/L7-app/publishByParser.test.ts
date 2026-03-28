import { describe, test, expect, vi, afterEach } from 'vitest'
import { parsePublishBy } from '../../../L7-app/parsePublishBy.js'

describe('parsePublishBy', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('relative format (+Nd)', () => {
    test('converts +7d to ISO date 7 days from now', () => {
      vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))

      const result = parsePublishBy('+7d')
      expect(result).toBe('2026-06-22')
    })

    test('converts +0d to today', () => {
      vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))

      const result = parsePublishBy('+0d')
      expect(result).toBe('2026-06-15')
    })

    test('is case-insensitive (+7D works)', () => {
      vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))

      const result = parsePublishBy('+7D')
      expect(result).toBe('2026-06-22')
    })

    test('trims whitespace', () => {
      vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))

      const result = parsePublishBy('  +7d  ')
      expect(result).toBe('2026-06-22')
    })
  })

  describe('ISO date format (YYYY-MM-DD)', () => {
    test('accepts valid ISO date', () => {
      const result = parsePublishBy('2026-03-15')
      expect(result).toBe('2026-03-15')
    })

    test('accepts date at year boundary', () => {
      const result = parsePublishBy('2026-01-01')
      expect(result).toBe('2026-01-01')
    })

    test('trims whitespace around ISO date', () => {
      const result = parsePublishBy('  2026-06-15  ')
      expect(result).toBe('2026-06-15')
    })
  })

  describe('invalid values', () => {
    test('rejects random string', () => {
      expect(() => parsePublishBy('next-week')).toThrow(
        'Invalid --publish-by value "next-week"',
      )
    })

    test('rejects partial date', () => {
      expect(() => parsePublishBy('2026-03')).toThrow(
        'Invalid --publish-by value "2026-03"',
      )
    })

    test('rejects date with time component', () => {
      expect(() => parsePublishBy('2026-03-15T10:00:00')).toThrow(
        'Invalid --publish-by value',
      )
    })

    test('rejects empty string', () => {
      expect(() => parsePublishBy('')).toThrow(
        'Invalid --publish-by value',
      )
    })

    test('rejects relative format missing + prefix', () => {
      expect(() => parsePublishBy('7d')).toThrow(
        'Invalid --publish-by value "7d"',
      )
    })

    test('rejects slash-separated date', () => {
      expect(() => parsePublishBy('03/15/2026')).toThrow(
        'Invalid --publish-by value',
      )
    })
  })
})
