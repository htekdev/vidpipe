import { describe, it, expect } from 'vitest'
import { execCommand, execCommandSync, createModuleRequire } from '../../core/process.js'

describe('execCommand', () => {
  it('runs node --version and returns stdout starting with v', async () => {
    const result = await execCommand('node', ['--version'])
    expect(result.stdout.trim()).toMatch(/^v\d+/)
  })
})

describe('execCommandSync', () => {
  it('returns string starting with v', () => {
    const result = execCommandSync('node --version')
    expect(result).toMatch(/^v\d+/)
  })
})

describe('createModuleRequire', () => {
  it('returns a function', () => {
    const req = createModuleRequire(import.meta.url)
    expect(typeof req).toBe('function')
  })
})
