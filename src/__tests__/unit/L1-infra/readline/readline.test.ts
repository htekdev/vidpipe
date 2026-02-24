import { vi, describe, it, expect } from 'vitest'

const mockCreateInterface = vi.hoisted(() => vi.fn().mockReturnValue({
  question: vi.fn(),
  once: vi.fn(),
  close: vi.fn(),
}))

vi.mock('node:readline', () => ({
  createInterface: mockCreateInterface,
}))

import { createChatInterface } from '../../../../L1-infra/readline/readline.js'

describe('createChatInterface', () => {
  it('calls createInterface with terminal: false to prevent double echo', () => {
    createChatInterface()

    expect(mockCreateInterface).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: false }),
    )
  })

  it('defaults to process.stdin and process.stdout', () => {
    createChatInterface()

    expect(mockCreateInterface).toHaveBeenCalledWith(
      expect.objectContaining({
        input: process.stdin,
        output: process.stdout,
      }),
    )
  })

  it('accepts custom input and output streams', () => {
    const mockInput = { on: vi.fn() } as unknown as NodeJS.ReadableStream
    const mockOutput = { write: vi.fn() } as unknown as NodeJS.WritableStream

    createChatInterface({ input: mockInput, output: mockOutput })

    expect(mockCreateInterface).toHaveBeenCalledWith(
      expect.objectContaining({
        input: mockInput,
        output: mockOutput,
        terminal: false,
      }),
    )
  })
})
