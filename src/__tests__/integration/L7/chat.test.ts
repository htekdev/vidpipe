import { describe, it, expect, vi, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'

// ── Mock setup (L1 + L3 only) ────────────────────────────────────────

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  setChatMode: vi.fn(),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ LATE_API_KEY: '' }),
  initConfig: vi.fn(),
}))

const mockQuestion = vi.hoisted(() => vi.fn())
const mockClose = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/readline/readline.js', () => ({
  createChatInterface: vi.fn(() => ({
    question: mockQuestion,
    once: vi.fn(),
    close: mockClose,
  })),
}))

vi.mock('../../../L3-services/llm/providerFactory.js', () => ({
  getProvider: vi.fn(),
}))

describe('L7 Integration: chat module', () => {
  it('chat module is importable and exports runChat', async () => {
    const mod = await import('../../../L7-app/commands/chat.js')
    expect(mod.runChat).toBeDefined()
    expect(typeof mod.runChat).toBe('function')
  })

  it('runChat creates readline interface and exits on quit', async () => {
    // Mock question to immediately return "exit"
    mockQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
      cb('exit')
    })

    const { runChat } = await import('../../../L7-app/commands/chat.js')
    await runChat()

    expect(mockQuestion).toHaveBeenCalled()
    expect(mockClose).toHaveBeenCalled()
  })
})
