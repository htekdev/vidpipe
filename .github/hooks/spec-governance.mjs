import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseObjectArgs(toolArgs) {
  const args = typeof toolArgs === 'string' ? JSON.parse(toolArgs) : toolArgs ?? {};
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new TypeError('Expected tool arguments to be a JSON object');
  }
  return args;
}

/**
 * Evaluate the spec reminder or staged requirement gate for a Copilot tool event.
 * The event's cwd identifies the repository whose staged changes are checked.
 */
export function evaluateHook(event, phase) {
  if (phase === 'pre' && !['bash', 'powershell'].includes(event.toolName)) return {};

  if (phase === 'post') {
    let paths;
    if (event.toolName === 'apply_patch') {
      let patch;
      if (typeof event.toolArgs === 'string' && event.toolArgs.trimStart().startsWith('*** Begin Patch')) {
        patch = event.toolArgs;
      } else {
        const args = parseObjectArgs(event.toolArgs);
        patch = args.patch ?? args.input ?? '';
      }
      paths = [...String(patch).matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+)\r?$/gm)]
        .map(match => match[1].trim());
    } else if (['edit', 'create'].includes(event.toolName)) {
      paths = [String(parseObjectArgs(event.toolArgs).path ?? '')];
    } else {
      return {};
    }

    const specs = [...new Set(paths.map(path => path.replaceAll('\\', '/')))]
      .filter(path => /(^|\/)specs\/.*\.md$/i.test(path));
    if (!specs.length) return {};
    return {
      additionalContext: specs.map(path => `Spec changed: ${path}. Add or update tests under src/__tests__/ with `
        + `${basename(path, '.md')}.REQ-XXX references for each changed requirement before committing. `
        + 'Tests belong in src/__tests__/, not specs/__tests__/.').join('\n'),
    };
  }

  if (!['bash', 'powershell'].includes(event.toolName)) return {};
  const args = parseObjectArgs(event.toolArgs);
  const command = String(args.command ?? '');
  if (!/\b(?:git\s+(?:--\S+\s+)*(?:commit|push)\b|npm\s+run\s+(?:commit|push)\b|gh\s+hookflow\s+git-push\b)/i.test(command)) {
    return {};
  }

  const git = (...args) => execFileSync('git', ['-C', event.cwd ?? process.cwd(), ...args], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const files = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z')
    .split('\0').filter(Boolean);
  const specs = files.filter(path => /^specs\/.*\.md$/i.test(path));
  if (!specs.length) return {};

  const addedLines = path => git('diff', '--cached', '--no-ext-diff', '--no-textconv', '-U0', '--', path)
    .split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).join('\n');
  const testChanges = files.filter(path => /^src\/__tests__\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path))
    .map(addedLines).join('\n');
  const missing = new Set();
  for (const path of specs) {
    const specName = basename(path, '.md');
    for (const [, req] of addedLines(path).matchAll(/\|\s*(REQ-\d+)\s*\|/g)) {
      const reference = `${specName}.${req}`;
      const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`(?<![\\w.])${escaped}(?![\\w-])`).test(testChanges)) missing.add(reference);
    }
  }
  if (!missing.size) return {};
  return {
    permissionDecision: 'deny',
    permissionDecisionReason: `Spec requirements missing staged test references: ${[...missing].join(', ')}. `
      + 'Add matching requirement IDs to test names under src/__tests__/ and stage the test changes.',
  };
}

/** Convert stdin JSON into hook protocol output, keeping errors actionable. */
export function runHook(input, phase) {
  try {
    const result = evaluateHook(JSON.parse(input), phase);
    return { output: Object.keys(result).length ? `${JSON.stringify(result)}\n` : '', diagnostic: '' };
  } catch (error) {
    const message = `Spec governance evaluation failed: ${error.message}`;
    if (phase === 'pre') {
      return {
        output: `${JSON.stringify({
          permissionDecision: 'deny',
          permissionDecisionReason: `${message}. Check the hook input and Git working directory, then retry.`,
        })}\n`,
        diagnostic: '',
      };
    }
    return { output: '', diagnostic: `${message}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { output, diagnostic } = runHook(readFileSync(0, 'utf8'), process.argv[2]);
  process.stdout.write(output);
  process.stderr.write(diagnostic);
}
