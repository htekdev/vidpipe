import { defineConfig } from 'vitest/config';
import { COVERAGE_SCOPES, BASE_EXCLUDE, L7_ENTRY_POINTS } from './cicd/lib/coverageScopes.js';
import type { CoverageScope } from './cicd/lib/coverageScopes.js';

// ── Coverage scope definitions per workspace ──
// Vitest does NOT support per-project coverage config — it's always global.
// We parse --project from CLI args and select the right scope dynamically.
// Scope definitions live in cicd/lib/coverageScopes.ts (shared with commit gate).

// Detect which single project is running via --project CLI arg
function getActiveProject(): string | undefined {
  const projects: string[] = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--project' && i + 1 < process.argv.length) {
      projects.push(process.argv[++i])
    }
  }
  return projects.length === 1 ? projects[0] : undefined
}

const activeProject = getActiveProject()
const scope = activeProject ? COVERAGE_SCOPES[activeProject] : undefined

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: scope
        ? ['text', 'text-summary', 'json-summary', 'json']
        : ['text', 'text-summary', 'lcov', 'html', 'json-summary', 'json'],
      include: scope?.include ?? ['src/**/*.ts'],
      exclude: scope?.exclude ?? [...BASE_EXCLUDE, ...L7_ENTRY_POINTS],
      reportsDirectory: scope?.reportsDirectory ?? 'coverage',
      thresholds: scope?.thresholds ?? { statements: 0, branches: 0, functions: 0, lines: 0 },
    },
    testTimeout: 30000,

    // ── Per-tier test projects ──
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/__tests__/unit/**/*.test.ts'],
          setupFiles: ['src/__tests__/setup.ts'],
          testTimeout: 10_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration-L3',
          include: ['src/__tests__/integration/L3/**/*.test.ts'],
          setupFiles: ['src/__tests__/setup.ts'],
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration-L4-L6',
          include: ['src/__tests__/integration/L4-L6/**/*.test.ts'],
          setupFiles: ['src/__tests__/setup.ts'],
          testTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration-L7',
          include: ['src/__tests__/integration/L7/**/*.test.ts'],
          setupFiles: ['src/__tests__/setup.ts'],
          testTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['src/__tests__/e2e/**/*.test.ts'],
          setupFiles: ['src/__tests__/setup.ts'],
          testTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'cicd',
          include: ['cicd/__tests__/**/*.test.ts'],
          setupFiles: [],
          testTimeout: 10_000,
        },
      },
    ],
  },
});
