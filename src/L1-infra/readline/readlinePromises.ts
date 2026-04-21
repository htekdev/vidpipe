import { createInterface, type Interface } from 'node:readline/promises'

export type { Interface as ReadlineInterface }

export interface PromptInterfaceOptions {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
}

/**
 * Creates a readline/promises interface for interactive prompts.
 */
export function createPromptInterface(options?: PromptInterfaceOptions): Interface {
  return createInterface({
    input: options?.input ?? process.stdin,
    output: options?.output ?? process.stdout,
  })
}
