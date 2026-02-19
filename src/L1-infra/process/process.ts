import { execFile as nodeExecFile, execSync as nodeExecSync, spawnSync as nodeSpawnSync } from 'child_process'
import type { ExecFileOptions, SpawnSyncReturns, SpawnSyncOptions } from 'child_process'
import { createRequire } from 'module'

export type { ExecFileOptions }

export interface ExecResult {
  stdout: string
  stderr: string
}

/**
 * Execute a command asynchronously via execFile.
 * Returns promise of { stdout, stderr }.
 */
export function execCommand(
  cmd: string,
  args: string[],
  opts?: ExecFileOptions & { maxBuffer?: number },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    nodeExecFile(cmd, args, { ...opts, encoding: 'utf-8' } as any, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }))
      } else {
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      }
    })
  })
}

/**
 * Execute a command with a callback (for cases where consumers need the raw callback pattern).
 * This matches the execFile signature used by captionBurning, singlePassEdit, etc.
 */
export function execFileRaw(
  cmd: string,
  args: string[],
  opts: ExecFileOptions & { maxBuffer?: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void,
): void {
  nodeExecFile(cmd, args, { ...opts, encoding: 'utf-8' } as any, (error, stdout, stderr) => {
    callback(error, String(stdout ?? ''), String(stderr ?? ''))
  })
}

/**
 * Execute a command synchronously. Returns trimmed stdout.
 * Throws on failure.
 */
export function execCommandSync(cmd: string, opts?: { encoding?: BufferEncoding; stdio?: any; cwd?: string }): string {
  return nodeExecSync(cmd, { encoding: 'utf-8' as BufferEncoding, ...opts }).toString().trim()
}

/**
 * Spawn a command synchronously. Returns full result including status.
 */
export function spawnCommand(
  cmd: string,
  args: string[],
  opts?: SpawnSyncOptions,
): SpawnSyncReturns<string> {
  return nodeSpawnSync(cmd, args, { encoding: 'utf-8', ...opts }) as SpawnSyncReturns<string>
}

/**
 * Create a require function for ESM modules to use CommonJS require().
 * Usage: const require = createModuleRequire(import.meta.url)
 */
export function createModuleRequire(metaUrl: string): NodeRequire {
  return createRequire(metaUrl)
}
