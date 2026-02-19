import { describe, it, expect, vi } from 'vitest'

// Import the REAL sanitizeForLog, bypassing the global setup mock
const { sanitizeForLog } = await vi.importActual<typeof import('../../../L1-infra/logger/configLogger.js')>(
  '../../../L1-infra/logger/configLogger.js'
)

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
