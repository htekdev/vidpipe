import { describe, expect, it, vi } from 'vitest'

const mockCreateInterface = vi.hoisted(() => vi.fn())

vi.mock('node:readline/promises', () => ({
  createInterface: mockCreateInterface,
}))

import { createPromptInterface } from '../../../L1-infra/readline/readlinePromises.js'

describe('L1 Unit: readlinePromises', () => {
  it('delegates to node:readline/promises createInterface with defaults', () => {
    const fakeInterface = { question: vi.fn(), close: vi.fn() }
    mockCreateInterface.mockReturnValue(fakeInterface)

    const result = createPromptInterface()

    expect(result).toBe(fakeInterface)
    expect(mockCreateInterface).toHaveBeenCalledWith({
      input: process.stdin,
      output: process.stdout,
    })
  })

  it('passes custom input and output when provided', () => {
    const fakeInterface = { question: vi.fn(), close: vi.fn() }
    mockCreateInterface.mockReturnValue(fakeInterface)
    const customInput = {} as NodeJS.ReadableStream
    const customOutput = {} as NodeJS.WritableStream

    const result = createPromptInterface({ input: customInput, output: customOutput })

    expect(result).toBe(fakeInterface)
    expect(mockCreateInterface).toHaveBeenCalledWith({
      input: customInput,
      output: customOutput,
    })
  })
})
