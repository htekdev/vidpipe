import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
const worktreeRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const stagedIndexes = [
  '',
  'src/L1-infra/config/modelConfig.ts\n',
  'src/L1-infra/config/modelConfig.ts\nsrc/__tests__/unit/L1-infra/modelConfig.test.ts\n',
]

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  execFileSync.mockReturnValue('src/L1-infra/config/modelConfig.ts\n')
  await import(extensionUrl.href)
  onPreToolUse = joinSession.mock.calls[0][0].hooks.onPreToolUse
})

it('testEnforcer.REQ-003: resolves the extension inside this test file’s worktree', () => {
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

  describe.each(stagedIndexes)('initial index %j', (files) => {
    it.each([
      'git add src/L1-infra/config/modelConfig.ts; npm run commit -- -m fix',
      'git add src/__tests__/unit/L1-infra/modelConfig.test.ts && npm run commit -- -m fix',
      'git add src/L1-infra/config/modelConfig.ts; git commit -m fix',
      'git add src/L1-infra/config/modelConfig.ts\nnpm run commit -- -m fix',
      'npm run commit; git status',
      'git commit -a -m fix',
      'git commit --include src/L1-infra/config/modelConfig.ts -m fix',
      'npm --prefix target run commit -- -m fix',
      'bash -c "npm run commit"',
      'powershell -Command "npm run commit"',
    ])('testEnforcer.REQ-004: rejects unsupported commit before reading index: %s', async (command) => {
      execFileSync.mockReturnValue(files)
      const result = await onPreToolUse({ toolName, toolArgs: { command } })
      expect(result?.permissionDecision).toBe('deny')
      expect(result?.permissionDecisionReason).toContain('separate tool call')
      expect(result?.permissionDecisionReason).toContain('session rooted in the target worktree')
      expect(result?.permissionDecisionReason).toContain('npm run commit')
      expect(execFileSync).not.toHaveBeenCalled()
    })
  })

  it('testEnforcer.REQ-005: anchors Git index reads to the extension worktree', async () => {
    await onPreToolUse({ toolName, toolArgs: { command: 'npm run commit' } })
    expect(execFileSync).toHaveBeenCalledExactlyOnceWith(
      'git', ['diff', '--cached', '--name-only'], expect.objectContaining({
        cwd: worktreeRoot,
        encoding: 'utf8',
        windowsHide: true,
      }),
    )
  })

  it.each([
    'git commit',
    'git commit --message fix',
    ' npm run commit -- ',
    'npm run commit -- --message fix',
    'git commit -m "fix; keep && separators | literal"',
    "npm run commit -- -m 'fix; keep && separators | literal'",
  ])('testEnforcer.REQ-001 REQ-002 REQ-006: checks safe standalone invocation: %s', async (command) => {
    expect((await onPreToolUse({ toolName, toolArgs: { command } }))?.permissionDecision).toBe('deny')
    execFileSync.mockReturnValue(stagedIndexes[2])
    expect(await onPreToolUse({ toolName, toolArgs: { command } })).toBeUndefined()
    expect(execFileSync).toHaveBeenCalledTimes(2)
  })

  it.each([
    String.raw`npm run commit -- -F "C:\repo worktree\commit-message.txt"`,
    String.raw`npm run commit -- -F 'C:\repo worktree\commit-message.txt'`,
    String.raw`npm run commit -- --file "C:\repo\commit-message.txt"`,
    String.raw`git commit -F "C:\repo worktree\commit-message.txt"`,
    'git commit --file commit-message.txt',
    'npm run commit -- -m "fix: hook arguments" -m "Regression coverage; literal && separators"',
    'git commit -m "fix: hook arguments" -m "Body | literal separators"',
    'npm run commit -- --message fix --message "Second paragraph"',
    'npm run commit -- -m fix --trailer "Co-authored-by: Copilot <copilot@github.com>"',
    'npm run commit -- -m fix --trailer "Co-authored-by: Copilot <copilot@github.com>" --trailer "Copilot-Session: session-id"',
    'git commit --trailer "Copilot-Session: session-id" -m fix',
    String.raw`npm run commit -- -F "C:\repo\commit-message.txt" --trailer "Co-authored-by: Copilot <copilot@github.com>"`,
  ])('testEnforcer.REQ-007: validates required option/value pairs without executing values: %s', async (command) => {
    for (const files of [stagedIndexes[2], stagedIndexes[1], stagedIndexes[0]]) {
      execFileSync.mockClear().mockReturnValue(files)
      const result = await onPreToolUse({ toolName, toolArgs: { command } })
      if (files === stagedIndexes[1]) {
        expect(result?.permissionDecision).toBe('deny')
        expect(result?.permissionDecisionReason).toContain('staged regression tests')
      } else {
        expect(result).toBeUndefined()
      }
      expect(execFileSync).toHaveBeenCalledExactlyOnceWith(
        'git', ['diff', '--cached', '--name-only'], {
          cwd: worktreeRoot, encoding: 'utf8', windowsHide: true,
        },
      )
    }
  })

  it.each([
    String.raw`npm run commit -- -F "C:\repo\message.txt"; git add src/model.ts`,
    String.raw`npm run commit -- -F "C:\repo\"; git add src/model.ts; npm run commit -- -m "fix"`,
    'npm run commit -- -F "$(git add src/model.ts)"',
    'npm run commit -- -m fix --trailer "$env:COMMIT_TRAILER"',
    'git commit -m fix --trailer "Co-authored-by: `git add src/model.ts`"',
    'npm run commit -- -m fix -m body --prefix target',
    'git commit --file message.txt --all',
    'npm run commit -- -F',
    'npm run commit -- -m',
    'npm run commit -- -m fix --trailer',
    'npm run commit -- -m fix --trailer Co-authored-by:Copilot<copilot@github.com>',
    'npm run commit -- --file="message.txt"',
    '"npm" run commit -- -m fix',
    'npm run commit -- -m "fix"junk',
  ])('testEnforcer.REQ-007: rejects unsafe or unsupported tokens before reading any index: %s', async (command) => {
    for (const files of stagedIndexes) {
      execFileSync.mockReturnValue(files)
      expect((await onPreToolUse({ toolName, toolArgs: { command } }))?.permissionDecision).toBe('deny')
      expect(execFileSync).not.toHaveBeenCalled()
    }
  })

  it.each([
    'git commit -m "fix"; npm test',
    'git commit -m "$(git add src/model.ts)"',
    'git commit -m "`git add src/model.ts`"',
    "git commit -m 'fix\\'",
    'npm run commit -- -m "unterminated',
    'git commit -m "fix\nmessage"',
    'git commit -m "fix\u0000message"',
    'git commit -m "fix\u201d ; git add src/model.ts; npm run commit -- -m \u201cfix"',
    "git commit -m 'fix\u2019 ; git add src/model.ts; npm run commit -- -m \u2018fix'",
    'git commit -m "fix caf\u00e9"',
  ])('testEnforcer.REQ-006: rejects ambiguous literal syntax before reading index: %s', async (command) => {
    expect((await onPreToolUse({ toolName, toolArgs: { command } }))?.permissionDecision).toBe('deny')
    expect(execFileSync).not.toHaveBeenCalled()
  })

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

  it.each([
    'git add cicd/commit.ts',
    'git diff -- cicd/commit.ts',
    'git add "cicd/commit.ts"',
    "git diff -- 'cicd/commit.ts'",
    'git diff -- commit',
    'git add commit',
    'git show HEAD:cicd/commit.ts',
    'git log --grep=commit',
    'git log --grep="git commit"',
    'git log --grep="npm run commit; git commit"',
    'echo git commit',
    'echo "git commit"',
    'Write-Output "npm run commit"',
    'npm test -- cicd/commit.ts',
    'npm run lint -- --message "git commit"',
    'echo "git commit; npm run commit && git commit"',
    'git diff -- cicd/commit.ts; git add cicd/commit.ts',
    'git -C target diff -- cicd/commit.ts',
    'npm --prefix target run lint -- commit.ts',
    'printf "%s" "git commit"',
    'bash -c "git diff -- cicd/commit.ts"',
    'powershell -Command "Write-Output \'git commit\'"',
  ])('testEnforcer.REQ-008: ignores commit text outside command/subcommand positions: %s', async (command) => {
    for (const files of stagedIndexes) {
      execFileSync.mockReturnValue(files)
      expect(await onPreToolUse({ toolName, toolArgs: { command } })).toBeUndefined()
      expect(execFileSync).not.toHaveBeenCalled()
    }
  })

  it.each([
    'git add cicd/commit.ts && npm run commit -- -m fix',
    'git diff -- cicd/commit.ts; git commit -m fix',
    'Set-Location target; git -C other commit -m fix',
    'git --git-dir target commit -m fix',
    'git --work-tree=target commit -m fix',
    'npm --prefix=target run commit -- -m fix',
    'echo "git commit"; npm run commit',
    'bash -c "git add cicd/commit.ts; npm run commit -- -m fix"',
    'powershell -NoProfile -Command "Set-Location target; npm run commit -- -m fix"',
  ])('testEnforcer.REQ-008: still rejects real compound/target commits before reading any index: %s', async (command) => {
    for (const files of stagedIndexes) {
      execFileSync.mockReturnValue(files)
      expect((await onPreToolUse({ toolName, toolArgs: { command } }))?.permissionDecision).toBe('deny')
      expect(execFileSync).not.toHaveBeenCalled()
    }
  })
})

describe('different repository indexes', () => {
  let fixtureRoot: string
  let cleanRoot: string
  let sourceRoot: string
  let testedRoot: string
  let cleanIndex: string
  let sourceIndex: string
  let testedIndex: string

  beforeAll(async () => {
    const { execFileSync: git } = await vi.importActual<typeof import('node:child_process')>('node:child_process')
    fixtureRoot = mkdtempSync(resolve(worktreeRoot, '.test-enforcer-'))
    ;[cleanRoot, sourceRoot, testedRoot] = ['clean', 'source-only', 'source-and-test'].map((name) => {
      const cwd = resolve(fixtureRoot, name)
      mkdirSync(cwd)
      git('git', ['init', '--quiet', cwd], { windowsHide: true })
      return cwd
    })
    for (const cwd of [sourceRoot, testedRoot]) {
      mkdirSync(resolve(cwd, 'src'), { recursive: true })
      writeFileSync(resolve(cwd, 'src/model.ts'), 'export const model = "fixture"\n')
      if (cwd === testedRoot) {
        mkdirSync(resolve(cwd, 'src/__tests__'), { recursive: true })
        writeFileSync(resolve(cwd, 'src/__tests__/model.test.ts'), '// regression fixture\n')
      }
      git('git', ['add', 'src'], { cwd, windowsHide: true })
    }
    ;[cleanIndex, sourceIndex, testedIndex] = [cleanRoot, sourceRoot, testedRoot].map((cwd) =>
      git('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf8', windowsHide: true }),
    )
    expect(cleanIndex).toBe('')
    expect(sourceIndex).toBe('src/model.ts\n')
    expect(testedIndex).toContain('src/__tests__/model.test.ts\n')
  })

  afterAll(() => {
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it.each([
    ['bash', 'cd'],
    ['powershell', 'cd'],
    ['powershell', 'Set-Location -LiteralPath'],
    ['powershell', 'Push-Location'],
  ])('testEnforcer.REQ-004: %s rejects %s target with differing real indexes before Git', async (toolName, prefix) => {
    for (const [currentIndex, target] of [
      [cleanIndex, sourceRoot],
      [sourceIndex, testedRoot],
      [testedIndex, sourceRoot],
    ]) {
      execFileSync.mockReturnValue(currentIndex)
      const command = `${prefix} "${target}" ${toolName === 'bash' ? '&&' : ';'} npm run commit -- -m fix`
      expect((await onPreToolUse({ toolName, toolArgs: { command } }))?.permissionDecision).toBe('deny')
      expect(execFileSync).not.toHaveBeenCalled()
    }
  })

  it.each(['bash', 'powershell'])('testEnforcer.REQ-004: %s rejects Git -C target before Git', async (toolName) => {
    execFileSync.mockReturnValue(cleanIndex)
    const command = `git -C "${sourceRoot}" commit -m fix`
    expect((await onPreToolUse({ toolName, toolArgs: { command } }))?.permissionDecision).toBe('deny')
    expect(execFileSync).not.toHaveBeenCalled()
  })
})

it('testEnforcer.REQ-002: ignores tools other than supported shells', async () => {
  expect(await onPreToolUse({ toolName: 'view', toolArgs: { command: 'git commit' } })).toBeUndefined()
  expect(execFileSync).not.toHaveBeenCalled()
})
