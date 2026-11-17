import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { evaluateHook, runHook } from '../../../../.github/hooks/spec-governance.mjs';
import { buildFileArgs } from '../../../../cicd/lib/testRunner.js';

const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const config = JSON.parse(readFileSync(join(root, '.github', 'hooks', 'hooks.json'), 'utf8'));
let fixture: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: fixture, encoding: 'utf8' });
}

function stage(path: string, content: string): void {
  const file = join(fixture, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  git('add', '--', path);
}

function event(toolName: string, toolArgs: Record<string, string>, serialized = true) {
  return { cwd: fixture, toolName, toolArgs: serialized ? JSON.stringify(toolArgs) : toolArgs };
}

beforeEach(() => {
  fixture = join(root, 'workdir', `hook-regression-${process.pid}-${crypto.randomUUID()}`);
  mkdirSync(fixture, { recursive: true });
  git('init', '--quiet');
  git('config', 'core.autocrlf', 'false');
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('SpecGovernance', () => {
  test.each(['it', 'test', 'describe'])('SpecGovernance.REQ-002: runs full files for multiline %s.each tables', (kind) => {
    const file = join(fixture, 'table.test.ts');
    writeFileSync(file, [
      "import { it, test, describe, expect } from 'vitest';",
      `${kind}.each([`,
      '  [1],',
      '  [2],',
      "])('accepts %i', (value) => {",
      '  expect(value).toBeGreaterThan(0);',
      '});',
    ].join('\n'));
    expect(buildFileArgs([{
      file, tier: 'unit', layer: -1, changedLines: [{ start: 3, end: 4 }],
    }])).toEqual([file]);
  });

  test('SpecGovernance.REQ-002: commit analysis includes hook unit tests in spec traceability', () => {
    const testPath = 'src/__tests__/unit/hooks/widget.test.ts';
    stage(testPath, "test('Widget.REQ-001', () => expect(true).toBe(true));");
    const analyzerUrl = new URL('../../../../cicd/lib/diffAnalyzer.ts', import.meta.url).href;
    const script = `import { analyzeStagedChanges } from ${JSON.stringify(analyzerUrl)}; process.stdout.write(JSON.stringify(analyzeStagedChanges()));`;
    const result = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: fixture, encoding: 'utf8',
    }));
    expect(result.testChanges).toEqual([
      { file: testPath, tier: 'unit', layer: -1, changedLines: [{ start: 1, end: 1 }] },
    ]);
    expect(result.exempt).not.toContain(testPath);
  });

  test('SpecGovernance.REQ-001: all registered script paths exist on both platforms', () => {
    for (const hooks of Object.values(config.hooks) as Record<string, string>[][]) {
      for (const hook of hooks) {
        for (const platform of ['bash', 'powershell']) {
          for (const script of hook[platform].matchAll(/\.github\/hooks\/[\w.-]+\.(?:ps1|sh|mjs)/g)) {
            expect(readFileSync(join(root, script[0])).length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  test.runIf(process.platform === 'win32')('SpecGovernance.REQ-001: registered Windows entrypoints accept a read-only event', () => {
    const input = JSON.stringify(event('powershell', { command: 'Get-Location' }));
    for (const hook of [...config.hooks.preToolUse, ...config.hooks.postToolUse]) {
      if (!hook.powershell.includes('.github/hooks/')) continue;
      const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', hook.powershell], {
        cwd: root, input, encoding: 'utf8', timeout: 10_000,
      });
      expect(result.stderr, hook.powershell).toBe('');
      expect(result.status, `${hook.powershell}: ${result.stderr}`).toBe(0);
      expect(result.stdout.trim(), hook.powershell).toBe('');
    }
  }, 30_000);

  test.each(['git commit -m "spec"', 'git --no-pager push', 'npm run commit -- -m "spec"', 'npm run push', 'gh hookflow git-push origin main'])(
    'SpecGovernance.REQ-002: denies missing staged test references for %s', (command) => {
      stage('specs/L7-app/Widget.md', '| REQ-001 | Works | P0 |\n');
      const result = evaluateHook(event('powershell', { command }), 'pre');
      expect(result.permissionDecision).toBe('deny');
      expect(result.permissionDecisionReason).toContain('Widget.REQ-001');
      expect(result.permissionDecisionReason).toContain('src/__tests__/');
    },
  );

  test('SpecGovernance.REQ-002: unstaged tests and references for another spec do not satisfy staged requirements', () => {
    stage('specs/L7-app/Widget.md', '| REQ-001 | Works | P0 |\n');
    stage('src/__tests__/unit/L7/widget.test.ts', "test('Other.REQ-001', () => expect(true).toBe(true));");
    writeFileSync(join(fixture, 'src', '__tests__', 'unit', 'L7', 'widget.test.ts'),
      "test('Widget.REQ-001', () => expect(true).toBe(true));");
    expect(evaluateHook(event('bash', { command: 'npm run commit' }), 'pre').permissionDecision).toBe('deny');
  });

  test.each([true, false])('SpecGovernance.REQ-003: allows matching staged test changes (serialized=%s)', (serialized) => {
    stage('specs/L7-app/Widget.md', '| REQ-001 | Works | P0 |\n| REQ-002 | Also works | P0 |\n');
    stage('src/__tests__/unit/L7/widget.test.ts',
      "test('Widget.REQ-001 and Widget.REQ-002', () => expect(true).toBe(true));");
    expect(evaluateHook(event('powershell', { command: 'npm run commit' }, serialized), 'pre')).toEqual({});
  });

  test('SpecGovernance.REQ-003: allows unrelated tools and spec documentation without requirement changes', () => {
    stage('specs/L7-app/Widget.md', '# Widget\nArchitecture notes.\n');
    for (const input of [
      event('powershell', { command: 'Get-Location' }),
      event('view', { path: 'specs/L7-app/Widget.md' }),
      event('edit', { path: 'specs/L7-app/Widget.md', new_str: '| REQ-001 | Works | P0 |' }),
      event('bash', { command: 'npm run commit' }),
    ]) expect(evaluateHook(input, 'pre')).toEqual({});
  });

  test.each(['pre', 'post'] as const)('SpecGovernance.REQ-003: accepts a raw non-spec patch in the %s hook', (phase) => {
    const input = {
      cwd: fixture,
      toolName: 'apply_patch',
      toolArgs: '*** Begin Patch\n*** Add File: notes.txt\n+Notes\n*** End Patch',
    };
    expect(runHook(JSON.stringify(input), phase)).toEqual({ output: '', diagnostic: '' });
  });

  test.each(['pre', 'post'] as const)('SpecGovernance.REQ-003: ignores unrelated FREEFORM arguments in the %s hook', (phase) => {
    const input = { cwd: fixture, toolName: 'custom_tool', toolArgs: 'not JSON' };
    expect(runHook(JSON.stringify(input), phase)).toEqual({ output: '', diagnostic: '' });
  });

  test.each(['edit', 'create'])('SpecGovernance.REQ-004: reminds after %s of a spec, including Windows paths', (toolName) => {
    const result = evaluateHook(event(toolName, { path: 'C:\\repo\\specs\\L7-app\\Widget.md' }, false), 'post');
    expect(result.additionalContext).toContain('Widget.REQ-XXX');
    expect(result.additionalContext).toContain('src/__tests__/');
    expect(result.permissionDecision).toBeUndefined();
  });

  test('SpecGovernance.REQ-004: leaves unrelated post-tool events quiet', () => {
    for (const input of [
      event('view', { path: 'specs/L7-app/Widget.md' }),
      event('edit', { path: 'src/Widget.ts' }),
      event('edit', { path: 'specs/image.png' }),
    ]) expect(evaluateHook(input, 'post')).toEqual({});
  });

  test.each([
    (patch: string) => patch,
    (patch: string) => ({ patch }),
    (patch: string) => JSON.stringify({ patch }),
    (patch: string) => ({ input: patch }),
    (patch: string) => JSON.stringify({ input: patch }),
  ])('SpecGovernance.REQ-004: reminds for specs in raw and wrapped patches (%#)', (wrap) => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: specs/hooks/Added.md',
      '+# Added',
      '*** Update File: C:\\repo\\specs\\hooks\\Updated.md',
      '@@',
      '-Old',
      '+New',
      '*** Update File: notes.md',
      '*** Move to: specs/hooks/Moved.md',
      '@@',
      '-Old',
      '+New',
      '*** End Patch',
    ].join('\r\n');
    const result = runHook(JSON.stringify({ cwd: fixture, toolName: 'apply_patch', toolArgs: wrap(patch) }), 'post');
    const reminder = JSON.parse(result.output).additionalContext;
    for (const specName of ['Added', 'Updated', 'Moved']) {
      expect(reminder).toContain(`${specName}.REQ-XXX`);
    }
    expect(reminder).toContain('src/__tests__/');
    expect(result.diagnostic).toBe('');
  });

  test('SpecGovernance.REQ-004: registered Node entrypoint handles FREEFORM patches through stdin', () => {
    const input = JSON.stringify({
      cwd: fixture,
      toolName: 'apply_patch',
      toolArgs: '*** Begin Patch\n*** Update File: specs/Widget.md\n@@\n-Old\n+New\n*** End Patch',
    });
    const script = join(root, '.github', 'hooks', 'spec-governance.mjs');
    for (const phase of ['pre', 'post']) {
      const result = spawnSync(process.execPath, [script, phase], { cwd: fixture, input, encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      if (phase === 'pre') expect(result.stdout).toBe('');
      else expect(JSON.parse(result.stdout).additionalContext).toContain('Widget.REQ-XXX');
    }
  });

  test.each(['not JSON', 'null', '[]', '"npm run commit"'])(
    'SpecGovernance.REQ-005: malformed shell arguments still deny validation (%s)', (toolArgs) => {
      const input = { cwd: fixture, toolName: 'powershell', toolArgs };
      const result = runHook(JSON.stringify(input), 'pre');
      expect(JSON.parse(result.output).permissionDecision).toBe('deny');
      expect(result.diagnostic).toBe('');
    },
  );

  test('SpecGovernance.REQ-005: validation errors produce a descriptive denial, not a process failure', () => {
    const failure = runHook('{malformed', 'pre');
    expect(JSON.parse(failure.output).permissionDecision).toBe('deny');
    expect(failure.diagnostic).toBe('');
    expect(runHook('{malformed', 'post').diagnostic).toContain('Spec governance');

    const script = join(root, '.github', 'hooks', 'spec-governance.mjs');
    const result = spawnSync(process.execPath, [script, 'pre'], {
      cwd: fixture, input: '{malformed', encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).permissionDecision).toBe('deny');
    expect(JSON.parse(result.stdout).permissionDecisionReason).toContain('Spec governance');

    const post = spawnSync(process.execPath, [script, 'post'], {
      cwd: fixture, input: '{malformed', encoding: 'utf8',
    });
    expect(post.status).toBe(0);
    expect(post.stdout).toBe('');
    expect(post.stderr).toContain('Spec governance');
  });

  test('SpecGovernance.REQ-005: Git validation errors deny only commit/push evaluation', () => {
    const input = { cwd: join(fixture, 'missing'), toolName: 'powershell', toolArgs: { command: 'npm run commit' } };
    const result = runHook(JSON.stringify(input), 'pre');
    expect(JSON.parse(result.output).permissionDecision).toBe('deny');
    expect(JSON.parse(result.output).permissionDecisionReason).toContain('Git working directory');
    input.toolArgs.command = 'Get-Location';
    expect(runHook(JSON.stringify(input), 'pre')).toEqual({ output: '', diagnostic: '' });
  });

  test('SpecGovernance.REQ-004: serializes post-spec reminders as valid hook JSON', () => {
    const result = runHook(JSON.stringify(event('edit', { path: 'specs/Widget.md' })), 'post');
    expect(JSON.parse(result.output).additionalContext).toContain('Widget.REQ-XXX');
    expect(result.diagnostic).toBe('');
  });
});
