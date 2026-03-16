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

// @github/copilot-sdk v0.1.31+ imports "vscode-jsonrpc/node" without .js extension,
// which fails under Node.js 24 strict ESM resolution. Mock the SDK globally so
// tests that transitively import it don't crash at module load time.
// Tests that need specific SDK behavior (e.g. ai.test.ts) override this mock.
vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: vi.fn(function (this: Record<string, unknown>) {
    this.createSession = vi.fn().mockResolvedValue({
      sendMessage: vi.fn(),
      sendAndWait: vi.fn().mockResolvedValue({ data: { content: '' } }),
      destroy: vi.fn(),
      on: vi.fn(),
    })
  }),
  CopilotSession: vi.fn(),
  approveAll: vi.fn().mockReturnValue({ result: 'allow' }),
}))

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
