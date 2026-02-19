import { describe, it, expect, vi, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'

const mockAgent = {
  setChatOutput: vi.fn(),
  run: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../../L6-pipeline/scheduleChat.js', () => ({
  loadScheduleAgent: vi.fn().mockResolvedValue({
    ScheduleAgent: class MockScheduleAgent {
      setChatOutput = mockAgent.setChatOutput
      run = mockAgent.run
      destroy = mockAgent.destroy
    },
  }),
}))

describe('L7 Unit: chat command', () => {
  const originalStdin = process.stdin

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true })
  })

  it('chat module exports runChat function', async () => {
    const mod = await import('../../../L7-app/commands/chat.js')
    expect(mod.runChat).toBeDefined()
    expect(typeof mod.runChat).toBe('function')
  })

  it('runChat creates readline and exits on quit command', async () => {
    // Provide a fake stdin that sends "exit" immediately
    const fakeStdin = new PassThrough()
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true })

    const { runChat } = await import('../../../L7-app/commands/chat.js')
    const chatPromise = runChat()

    // Feed "exit" to the readline
    fakeStdin.push('exit\n')

    await chatPromise

    expect(mockAgent.destroy).toHaveBeenCalled()
  })
})
