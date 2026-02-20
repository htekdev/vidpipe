/**
 * Global vitest setup — auto-silences the logger across all tests.
 *
 * This eliminates the most common mocking violation: every test file
 * individually mocking configLogger.js just to suppress console output.
 *
 * Tests that need to assert on logger calls can still vi.mock() it
 * themselves — this setup just provides the default silent behavior.
 */
import { vi } from 'vitest'

vi.mock('../L1-infra/logger/configLogger.js', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    silly: vi.fn(),
    level: 'info',
    transports: [],
  }
  return {
    default: mockLogger,
    sanitizeForLog: vi.fn((v: unknown) => String(v)),
    setVerbose: vi.fn(),
    setChatMode: vi.fn(),
    pushPipe: vi.fn(),
    popPipe: vi.fn(),
  }
})
