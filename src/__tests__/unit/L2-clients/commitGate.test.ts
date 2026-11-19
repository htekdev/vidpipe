import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the CICD entry point outside the source project's TypeScript rootDir.
const commitGatePath = '../../../../cicd/lib/commitGate.js';
const commitGateUrl = new URL(commitGatePath, import.meta.url);
let runCommitGate: (options: {
  threshold: number;
  skipCoverage: boolean;
  dryRun: boolean;
  commitArgs: string[];
}) => Promise<boolean>;

const { execSync, execFileSync } = vi.hoisted(() => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock('child_process', () => ({ execSync, execFileSync }));

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  // No staged source/spec changes: exercise the real gate's final commit path.
  execSync.mockReturnValue('');
  execFileSync.mockReturnValue('committed\n');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  runCommitGate = (await import(commitGateUrl.href)).runCommitGate;
});

afterEach(() => vi.restoreAllMocks());

describe('commitGate final Git invocation', () => {
  it.each([
    { name: 'separator-only message', commitArgs: ['-m', 'literal;separator&pipe|<angle>'] },
    { name: 'quoted and repeated messages', commitArgs: [
      '-m', 'fix: preserve "quotes"', '-m', 'literal $HOME `text` %PATH% && separators',
    ] },
    { name: 'Windows file and attribution/session trailers', commitArgs: [
      '-F', String.raw`C:\repo worktree\message.txt`, '--trailer', 'Co-authored-by: Copilot <copilot@github.com>',
      '--trailer', 'Copilot-Session: session-id',
    ] },
  ])('commitGate.REQ-001: forwards literal argv without a shell: $name', async ({ commitArgs }) => {
    expect(await runCommitGate({ threshold: 80, skipCoverage: false, dryRun: false, commitArgs })).toBe(true);
    expect(execFileSync).toHaveBeenCalledExactlyOnceWith('git', ['commit', ...commitArgs], {
      encoding: 'utf-8',
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: false,
    });
    expect(execSync).toHaveBeenCalledExactlyOnceWith('git diff --cached --name-only', { encoding: 'utf-8' });
  });

  it('commitGate.REQ-002: dry run never invokes the commit subprocess', async () => {
    expect(await runCommitGate({
      threshold: 80, skipCoverage: false, dryRun: true, commitArgs: ['-m', 'fix'],
    })).toBe(true);
    expect(execFileSync).not.toHaveBeenCalled();
    expect(execSync).toHaveBeenCalledExactlyOnceWith('git diff --cached --name-only', { encoding: 'utf-8' });
  });

  it('commitGate.REQ-003: reports Git failure without a shell fallback', async () => {
    execFileSync.mockImplementation(() => { throw Object.assign(new Error('Git failed'), { stderr: 'rejected\n' }); });
    expect(await runCommitGate({
      threshold: 80, skipCoverage: false, dryRun: false, commitArgs: ['-m', 'fix'],
    })).toBe(false);
    expect(console.error).toHaveBeenCalledWith('❌ git commit failed:', 'rejected');
    expect(execFileSync).toHaveBeenCalledOnce();
    expect(execSync).toHaveBeenCalledExactlyOnceWith('git diff --cached --name-only', { encoding: 'utf-8' });
  });
});
