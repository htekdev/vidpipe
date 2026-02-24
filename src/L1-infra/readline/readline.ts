import { createInterface, type Interface } from 'node:readline'

export interface ChatInterfaceOptions {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
}

/**
 * Creates a readline interface configured for chat use.
 * Uses `terminal: false` to prevent double-echo on Windows.
 */
export function createChatInterface(options?: ChatInterfaceOptions): Interface {
  return createInterface({
    input: options?.input ?? process.stdin,
    output: options?.output ?? process.stdout,
    terminal: false,
  })
}
