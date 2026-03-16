export { CopilotClient, CopilotSession, approveAll } from '@github/copilot-sdk'
export type { SessionEvent } from '@github/copilot-sdk'

import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'

/**
 * Resolve the platform-native Copilot CLI binary path.
 *
 * The SDK's default `getBundledCliPath()` returns a `.js` wrapper. When spawned,
 * the SDK runs it via `process.execPath` (Node.js), which inherits Node.js runtime
 * behaviour (stderr warnings, event-loop exits). The native binary avoids these
 * issues entirely.
 *
 * Returns `undefined` when the native binary can't be found, so the SDK falls
 * back to its default `.js` wrapper.
 */
export function resolveCopilotCliPath(): string | undefined {
  const platform = process.platform   // win32, darwin, linux
  const arch = process.arch           // x64, arm64
  const binaryName = platform === 'win32' ? 'copilot.exe' : 'copilot'
  const platformPkg = `@github/copilot-${platform}-${arch}`

  try {
    const require_ = createRequire(import.meta.url)
    const searchPaths = require_.resolve.paths(platformPkg) ?? []

    for (const base of searchPaths) {
      const candidate = join(base, platformPkg, binaryName)
      if (existsSync(candidate)) return candidate
    }
  } catch {
    // createRequire or resolve.paths failed — fall through
  }

  // Walk up from this file looking for node_modules/@github/copilot-<platform>-<arch>
  let dir = dirname(import.meta.dirname ?? __dirname)
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', platformPkg, binaryName)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return undefined
}
