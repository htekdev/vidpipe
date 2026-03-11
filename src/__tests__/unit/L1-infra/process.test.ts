import { describe, it, expect } from 'vitest'
import { execCommand, execFileRaw, execCommandSync, spawnCommand, createModuleRequire } from '../../../L1-infra/process/process.js'

describe('execCommand', () => {
  it('runs node --version and returns stdout starting with v', async () => {
    const result = await execCommand('node', ['--version'])
    expect(result.stdout.trim()).toMatch(/^v\d+/)
  })

  it('rejects with error on failed command', async () => {
    await expect(execCommand('node', ['-e', 'process.exit(1)'])).rejects.toThrow()
  })

  it('attaches stdout and stderr to rejection error', async () => {
    try {
      await execCommand('node', ['-e', 'console.error("oops"); process.exit(1)'])
    } catch (err: unknown) {
      expect((err as { stderr: string }).stderr).toContain('oops')
    }
  })
})

describe('execFileRaw', () => {
  it('invokes callback with stdout on success', async () => {
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
      execFileRaw('node', ['--version'], {}, (error, stdout, stderr) => {
        resolve({ stdout, stderr })
      })
    })
    expect(result.stdout.trim()).toMatch(/^v\d+/)
  })

  it('invokes callback with error on failure', async () => {
    const result = await new Promise<{ error: Error | null }>((resolve) => {
      execFileRaw('node', ['-e', 'process.exit(1)'], {}, (error) => {
        resolve({ error })
      })
    })
    expect(result.error).not.toBeNull()
  })
})

describe('execCommandSync', () => {
  it('returns string starting with v', () => {
    const result = execCommandSync('node --version')
    expect(result).toMatch(/^v\d+/)
  })

  it('throws on failed command', () => {
    expect(() => execCommandSync('node -e "process.exit(1)"')).toThrow()
  })
})

describe('spawnCommand', () => {
  it('returns result with status 0 on success', () => {
    const result = spawnCommand('node', ['--version'])
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toMatch(/^v\d+/)
  })

  it('returns non-zero status on failure', () => {
    const result = spawnCommand('node', ['-e', 'process.exit(42)'])
    expect(result.status).toBe(42)
  })
})

describe('createModuleRequire', () => {
  it('returns a function', () => {
    const req = createModuleRequire(import.meta.url)
    expect(typeof req).toBe('function')
  })
})
