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
  'src/L1-infra/config/modelConfig.ts\0',
  'src/L1-infra/config/modelConfig.ts\0src/__tests__/unit/L1-infra/modelConfig.test.ts\0',
]

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  execFileSync.mockReturnValue('src/L1-infra/config/modelConfig.ts\0')
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
        'git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], expect.objectContaining({ encoding: 'utf8' }),
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

  it('testEnforcer.REQ-010: rejects npm target options in either position before reading an index', async () => {
    for (const command of [
      'npm --prefix target run commit -- -m fix',
      'npm run --prefix target commit -- -m fix',
      'npm run --prefix=target commit -- -m fix',
      'npm --prefix target run --workspace sample commit -- -m fix',
    ]) {
      for (const files of stagedIndexes) {
        execFileSync.mockReturnValue(files)
        expect((await onPreToolUse({ toolName, toolArgs: { command } }))?.permissionDecision).toBe('deny')
        expect(execFileSync).not.toHaveBeenCalled()
      }
    }
  })

  it('testEnforcer.REQ-005: anchors Git index reads to the extension worktree', async () => {
    await onPreToolUse({ toolName, toolArgs: { command: 'npm run commit' } })
    expect(execFileSync).toHaveBeenCalledExactlyOnceWith(
      'git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], expect.objectContaining({
        cwd: worktreeRoot,
        encoding: 'utf8',
        windowsHide: true,
      }),
    )
  })

  it('testEnforcer.REQ-011: comment quotes cannot hide following compound or target-changing commits', async () => {
    for (const command of [
      '# "\ncd target; git commit -m "fix"',
      "# '\ncd target; npm run commit -- -m 'fix'",
      'echo ready # "\ngit -C target commit -m "fix"',
      '# "\nnpm run --prefix target commit -- -m "fix"',
    ]) {
      for (const files of stagedIndexes) {
        execFileSync.mockClear().mockReturnValue(files)
        const result = await onPreToolUse({ toolName, toolArgs: { command } })
        expect.soft(result?.permissionDecision, command).toBe('deny')
        expect(execFileSync).not.toHaveBeenCalled()
      }
    }
  })

  it('testEnforcer.REQ-011: ignores comment contents without treating quoted physical lines as commands', async () => {
    for (const command of [
      '# comment; git commit -m "fix"; npm run commit',
      'echo ready # comment; git commit -m "fix"',
      'git diff -- cicd/commit.ts # "; git commit -m "fix"',
      'git add "cicd/#commit.ts"',
      'git log --grep="# git commit; npm run commit"',
      'echo "# comment\n git commit -m fix\n npm run commit"',
      'echo issue#"\n git commit -m fix\n npm run commit"',
    ]) {
      for (const files of stagedIndexes) {
        execFileSync.mockClear().mockReturnValue(files)
        expect.soft(await onPreToolUse({ toolName, toolArgs: { command } }), command).toBeUndefined()
        expect(execFileSync).not.toHaveBeenCalled()
      }
    }
  })

  it('testEnforcer.REQ-011: still inspects standalone commits with literal quoted hash values', async () => {
    for (const command of [
      'git commit -m "# literal; git commit"',
      'npm run commit -- -m "fix # literal; npm run commit"',
    ]) {
      for (const files of stagedIndexes) {
        execFileSync.mockClear().mockReturnValue(files)
        const result = await onPreToolUse({ toolName, toolArgs: { command } })
        expect(result?.permissionDecision).toBe(files === stagedIndexes[1] ? 'deny' : undefined)
        expect(execFileSync).toHaveBeenCalledExactlyOnceWith(
          'git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'],
          expect.objectContaining({ cwd: worktreeRoot }),
        )
      }
    }
  })

  it('testEnforcer.REQ-012: explicit shell wrappers retain their named inner lexical mode', async () => {
    for (const { command, denied } of [
      { command: `powershell -NoProfile -Command 'Write-Output "ready"# "\ngit -C target commit -m "fix"'`, denied: true },
      { command: 'pwsh -Command \'Write-Output `"\nnpm run --prefix target commit -- -m "fix"\'', denied: true },
      { command: `bash -c 'echo "ready"# "\ngit commit -m fix"'`, denied: false },
    ]) {
      for (const files of stagedIndexes) {
        execFileSync.mockClear().mockReturnValue(files)
        const result = await onPreToolUse({ toolName, toolArgs: { command } })
        expect.soft(result?.permissionDecision, command).toBe(denied ? 'deny' : undefined)
        expect(execFileSync).not.toHaveBeenCalled()
      }
    }
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

  it('testEnforcer.REQ-007: validates required option/value pairs without executing values', async () => {
    for (const command of [
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
    ]) {
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
          'git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], {
            cwd: worktreeRoot, encoding: 'utf8', windowsHide: true,
          },
        )
      }
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
    'src/L1-infra/config/modelConfig.ts\0src/__tests__/unit/L1-infra/modelConfig.test.ts\0',
    'README.md\0',
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

  it('testEnforcer.REQ-008: ignores commit text outside command/subcommand positions', async () => {
    for (const command of [
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
      'npm run --prefix target lint -- commit',
      'npm run --prefix=target lint -- "npm run commit"',
      'printf "%s" "git commit"',
      'bash -c "git diff -- cicd/commit.ts"',
      'powershell -Command "Write-Output \'git commit\'"',
    ]) {
      for (const files of stagedIndexes) {
        execFileSync.mockReturnValue(files)
        expect(await onPreToolUse({ toolName, toolArgs: { command } })).toBeUndefined()
        expect(execFileSync).not.toHaveBeenCalled()
      }
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

describe('PowerShell literal candidate boundaries', () => {
  it('testEnforcer.REQ-012: detects literal commits after native quotes, comments and call operators before any index read', async () => {
    for (const command of [
      'Write-Output "ready"# "\ngit -C target commit -m "fix"',
      'Write-Output `"\ngit -C target commit -m "fix"',
      'Write-Output `"\nnpm run --prefix target commit -- -m "fix"',
      String.raw`& git -C "C:\target\" commit -m "fix"`,
      '& \'git\' commit -m "fix"',
      '& "npm" run commit -- -m "fix"',
      'npm run --prefix="target path" commit -- -m "fix"',
    ]) {
      for (const files of stagedIndexes) {
        execFileSync.mockClear().mockReturnValue(files)
        const result = await onPreToolUse({ toolName: 'powershell', toolArgs: { command } })
        expect.soft(result?.permissionDecision, command).toBe('deny')
        expect(execFileSync).not.toHaveBeenCalled()
      }
    }
  })

  it('testEnforcer.REQ-012: does not reinterpret escaped quotes, comment text or ordinary arguments as PowerShell commits', async () => {
    for (const command of [
      'Write-Output "ready"# "; git commit -m "fix"',
      'Write-Output "literal `" ; git commit -m fix"',
      'Write-Output "literal `"\n git commit -m fix"',
      "Write-Output 'it''s # ; git commit'",
      'Write-Output foo#bar',
      "& 'git' diff -- cicd/commit.ts",
      '& "npm" run lint -- commit',
    ]) {
      for (const files of stagedIndexes) {
        execFileSync.mockClear().mockReturnValue(files)
        expect.soft(await onPreToolUse({ toolName: 'powershell', toolArgs: { command } }), command).toBeUndefined()
        expect(execFileSync).not.toHaveBeenCalled()
      }
    }
  })
})

it('testEnforcer.REQ-012: retains Bash quote concatenation instead of applying PowerShell comment boundaries', async () => {
  const command = 'echo "ready"# "\ngit commit -m fix"'
  for (const files of stagedIndexes) {
    execFileSync.mockClear().mockReturnValue(files)
    expect(await onPreToolUse({ toolName: 'bash', toolArgs: { command } })).toBeUndefined()
    expect(execFileSync).not.toHaveBeenCalled()
  }
})

it('testEnforcer.REQ-013: classifies Unicode, newline and whitespace filenames from real indexes in both shells', async () => {
  const { execFileSync: git } = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  const cwd = mkdtempSync(resolve(worktreeRoot, '.test-enforcer-paths-'))
  const options = { cwd, encoding: 'utf8' as const, windowsHide: true }
  try {
    git('git', ['init', '--quiet', cwd], options)
    git('git', ['config', 'core.quotepath', 'true'], options)
    // Index-only fixtures can represent Git paths Windows cannot create on disk.
    git('git', ['config', 'core.protectNTFS', 'false'], options)
    const blob = git('git', ['hash-object', '-w', '--stdin'], { ...options, input: 'fixture\n' }).trim()
    for (const { paths, denied } of [
      { paths: ['src/é.ts'], denied: true },
      { paths: ['src/model.ts', 'src/__tests__/é.test.ts'], denied: false },
      { paths: ['src/é.ts', 'src/__tests__/é.test.ts'], denied: false },
      { paths: ['src/é.tsx'], denied: true },
      { paths: ['src/model.tsx', 'src/__tests__/é.test.tsx'], denied: false },
      { paths: ['src/line\nbreak.ts'], denied: true },
      { paths: ['src/model.ts', 'src/__tests__/line\nbreak.test.ts'], denied: false },
      { paths: ['src/model.ts', 'notes\nsrc/__tests__/fake.test.ts'], denied: true },
      { paths: [' src/not-source.ts'], denied: false },
      { paths: ['src/not-source.ts\n'], denied: false },
      { paths: ['src/model.ts', 'src/__tests__/not-a-test.test.ts\n'], denied: true },
    ]) {
      git('git', ['read-tree', '--empty'], options)
      git('git', ['update-index', '-z', '--index-info'], {
        ...options,
        input: paths.map((path) => `100644 ${blob}\t${path}\0`).join(''),
      })
      expect(git('git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], options)
        .split('\0').slice(0, -1)).toEqual([...paths].sort())
      if (paths.length === 1 && paths[0] === 'src/é.ts') {
        expect(git('git', ['diff', '--cached', '--name-only'], options)).toBe('"src/\\303\\251.ts"\n')
      }
      execFileSync.mockImplementation((executable, args, hookOptions) => {
        expect(hookOptions.cwd).toBe(worktreeRoot)
        return git(executable, args, { ...hookOptions, cwd })
      })
      for (const toolName of ['bash', 'powershell']) {
        execFileSync.mockClear()
        const result = await onPreToolUse({ toolName, toolArgs: { command: 'npm run commit' } })
        expect.soft(result?.permissionDecision, `${toolName}: ${JSON.stringify(paths)}`).toBe(denied ? 'deny' : undefined)
        expect(execFileSync).toHaveBeenCalledOnce()
      }
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

describe.each(['bash', 'powershell'])('staged deletions: %s', (toolName) => {
  it.each([
    { change: 'deleted test with modified source', denied: true, statuses: ['D\tsrc/__tests__/model.test.ts', 'M\tsrc/model.ts'] },
    { change: 'deleted source only', denied: false, statuses: ['D\tsrc/model.ts'] },
    { change: 'modified source and test', denied: false, statuses: ['M\tsrc/__tests__/model.test.ts', 'M\tsrc/model.ts'] },
  ])('testEnforcer.REQ-009: classifies a real index with $change', async ({ change, denied, statuses }) => {
    const { execFileSync: git } = await vi.importActual<typeof import('node:child_process')>('node:child_process')
    const cwd = mkdtempSync(resolve(worktreeRoot, '.test-enforcer-deletion-'))
    try {
      git('git', ['init', '--quiet', cwd], { windowsHide: true })
      mkdirSync(resolve(cwd, 'src/__tests__'), { recursive: true })
      writeFileSync(resolve(cwd, 'src/model.ts'), 'export const model = "baseline"\n')
      writeFileSync(resolve(cwd, 'src/__tests__/model.test.ts'), '// baseline test\n')
      git('git', ['add', 'src'], { cwd, windowsHide: true })
      // A real baseline tree permits staged-deletion diffs without creating commits.
      const baseline = git('git', ['write-tree'], { cwd, encoding: 'utf8', windowsHide: true }).trim()
      if (change === 'deleted source only') {
        rmSync(resolve(cwd, 'src/model.ts'))
      } else {
        writeFileSync(resolve(cwd, 'src/model.ts'), 'export const model = "changed"\n')
        if (change === 'deleted test with modified source') {
          rmSync(resolve(cwd, 'src/__tests__/model.test.ts'))
        } else {
          writeFileSync(resolve(cwd, 'src/__tests__/model.test.ts'), '// changed regression test\n')
        }
      }
      git('git', ['add', '-A'], { cwd, windowsHide: true })
      expect(git('git', ['diff', '--cached', baseline, '--name-status'], {
        cwd, encoding: 'utf8', windowsHide: true,
      }).trim().split(/\r?\n/)).toEqual(statuses)
      execFileSync.mockImplementation((executable, args, options) => {
        expect(options.cwd).toBe(worktreeRoot)
        // Compare the actual staged index to the baseline tree instead of HEAD.
        return git(executable, [...args.slice(0, 2), baseline, ...args.slice(2)], { ...options, cwd })
      })
      const result = await onPreToolUse({ toolName, toolArgs: { command: 'npm run commit' } })
      if (denied) {
        expect(result?.permissionDecision).toBe('deny')
        expect(result?.permissionDecisionReason).toContain('staged regression tests')
      } else {
        expect(result).toBeUndefined()
      }
      expect(execFileSync).toHaveBeenCalledOnce()
    } finally {
      rmSync(cwd, { recursive: true, force: true })
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
      git('git', ['diff', '--cached', '--name-only', '-z'], { cwd, encoding: 'utf8', windowsHide: true }),
    )
    expect(cleanIndex).toBe('')
    expect(sourceIndex).toBe('src/model.ts\0')
    expect(testedIndex).toContain('src/__tests__/model.test.ts\0')
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
