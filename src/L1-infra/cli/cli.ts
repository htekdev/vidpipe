import { Command } from 'commander'
import readline from 'readline'
import open from 'open'

export { Command }
export type { ReadLine } from 'readline'

/** Create a readline interface for interactive prompts. */
export function createReadlineInterface(opts?: readline.ReadLineOptions): readline.Interface {
  return readline.createInterface(opts ?? { input: process.stdin, output: process.stdout })
}

/** Open a URL in the default browser. */
export async function openUrl(url: string): Promise<void> {
  await open(url)
}
