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

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  execFileSync.mockReturnValue('src/L1-infra/config/modelConfig.ts\n')
  // Variable import keeps this .mjs entry point outside TypeScript source compilation.
  const extensionPath = '../../../../../.github/extensions/test-enforcer/extension.mjs'
  await import(extensionPath)
  onPreToolUse = joinSession.mock.calls[0][0].hooks.onPreToolUse
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
