import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileSync, joinSession } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  joinSession: vi.fn(),
}))

vi.mock('node:child_process', () => ({ execFileSync }))
vi.mock('@github/copilot-sdk/extension', () => ({ joinSession }))

type PreToolUse = (input: {
  toolName: string
  toolArgs?: { command?: string }
}) => Promise<{ permissionDecision: string; permissionDecisionReason: string } | undefined>

let onPreToolUse: PreToolUse

// Variable import keeps this .mjs entry point outside TypeScript source compilation.
const extensionPath = '../../../../.github/extensions/test-enforcer/extension.mjs'
const extensionUrl = new URL(extensionPath, import.meta.url)

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  execFileSync.mockReturnValue('src/L1-infra/config/modelConfig.ts\n')
  await import(extensionUrl.href)
  onPreToolUse = joinSession.mock.calls[0][0].hooks.onPreToolUse
})

it('testEnforcer.REQ-003: resolves the extension inside this test file’s worktree', () => {
  const worktreeRoot = resolve(import.meta.dirname, '../../../..')
  expect(fileURLToPath(extensionUrl)).toBe(
    resolve(worktreeRoot, '.github/extensions/test-enforcer/extension.mjs'),
  )
})

describe.each(['bash', 'powershell'])('test-enforcer shell integration: %s', (toolName) => {
  it.each(['git commit -m "fix"', 'npm run commit -- -m "fix"'])(
    'testEnforcer.REQ-001: denies source-only staged changes for %s',
    async (command) => {
      const result = await onPreToolUse({ toolName, toolArgs: { command } })
      expect(execFileSync).toHaveBeenCalledWith(
        'git', ['diff', '--cached', '--name-only'], expect.objectContaining({ encoding: 'utf8' }),
      )
      expect(result?.permissionDecision).toBe('deny')
      expect(result?.permissionDecisionReason).toContain('staged regression tests')
    },
  )

  it.each(['&&', ';'])(
    'testEnforcer.REQ-001: explains staging first when git add %s npm run commit has not executed',
    async (separator) => {
      const command = `git add src/__tests__/unit/L1-infra/modelConfig.test.ts ${separator} npm run commit -- -m fix`
      const result = await onPreToolUse({ toolName, toolArgs: { command } })
      expect(result?.permissionDecision).toBe('deny')
      expect(result?.permissionDecisionReason).toContain('before this shell command runs')
      expect(result?.permissionDecisionReason).toContain('separate tool call')
      expect(result?.permissionDecisionReason).toContain('npm run commit')
      expect(execFileSync).toHaveBeenCalledExactlyOnceWith(
        'git', ['diff', '--cached', '--name-only'], expect.objectContaining({ encoding: 'utf8' }),
      )
    },
  )

  it.each([
    'src/L1-infra/config/modelConfig.ts\nsrc/__tests__/unit/L1-infra/modelConfig.test.ts\n',
    'README.md\n',
    '',
  ])('testEnforcer.REQ-002: permits staged files %j', async (files) => {
    execFileSync.mockReturnValue(files)
    expect(await onPreToolUse({ toolName, toolArgs: { command: 'npm run commit' } })).toBeUndefined()
    expect(execFileSync).toHaveBeenCalledOnce()
  })

  it.each(['npm test', 'git status', undefined])('testEnforcer.REQ-002: ignores non-commit command %j', async (command) => {
    expect(await onPreToolUse({ toolName, toolArgs: { command } })).toBeUndefined()
    expect(execFileSync).not.toHaveBeenCalled()
  })
})

it('testEnforcer.REQ-002: ignores tools other than supported shells', async () => {
  expect(await onPreToolUse({ toolName: 'view', toolArgs: { command: 'git commit' } })).toBeUndefined()
  expect(execFileSync).not.toHaveBeenCalled()
})
