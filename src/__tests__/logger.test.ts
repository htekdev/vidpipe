import { describe, it, expect } from 'vitest'
import { sanitizeForLog } from '../config/logger.js'

describe('sanitizeForLog', () => {
  it('handles null', () => {
    expect(sanitizeForLog(null)).toBe('null')
  })

  it('handles undefined', () => {
    expect(sanitizeForLog(undefined)).toBe('undefined')
  })

  it('passes through normal strings', () => {
    expect(sanitizeForLog('hello world')).toBe('hello world')
  })

  it('escapes newlines', () => {
    expect(sanitizeForLog('line1\nline2')).toBe('line1\\nline2')
  })

  it('escapes carriage returns', () => {
    expect(sanitizeForLog('line1\rline2')).toBe('line1\\rline2')
  })

  it('escapes tabs', () => {
    expect(sanitizeForLog('col1\tcol2')).toBe('col1\\tcol2')
  })

  it('escapes mixed control characters', () => {
    expect(sanitizeForLog('a\r\n\tb')).toBe('a\\r\\n\\tb')
  })
})
