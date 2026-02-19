import { defineConfig } from 'vitest/config';

// ── Coverage scope definitions per workspace ──
// Vitest does NOT support per-project coverage config — it's always global.
// We parse --project from CLI args and select the right scope dynamically.

const BASE_EXCLUDE = [
  'src/**/*.test.ts',
  'src/**/*.d.ts',
  'src/__tests__/**',
]

const LLM_PROVIDERS = [
  'src/L2-clients/llm/CopilotProvider.ts',
  'src/L2-clients/llm/OpenAIProvider.ts',
  'src/L2-clients/llm/ClaudeProvider.ts',
  'src/L2-clients/llm/types.ts',
]

const L7_ENTRY_POINTS = [
  'src/L7-app/cli.ts',
  'src/L7-app/commands/init.ts',
  'src/L7-app/commands/schedule.ts',
]

interface CoverageScope {
  include: string[]
  exclude: string[]
  reportsDirectory: string
  thresholds: { statements: number; branches: number; functions: number; lines: number }
}

const COVERAGE_SCOPES: Record<string, CoverageScope> = {
  unit: {
    include: ['src/L0-pure/**/*.ts', 'src/L1-infra/**/*.ts', 'src/L2-clients/**/*.ts', 'src/L3-services/**/*.ts', 'src/L4-agents/**/*.ts', 'src/L5-assets/**/*.ts', 'src/L6-pipeline/**/*.ts'],
    exclude: [...BASE_EXCLUDE, ...LLM_PROVIDERS, 'src/L7-app/**/*.ts'],
    reportsDirectory: 'coverage/unit',
    thresholds: { statements: 69, branches: 63, functions: 71, lines: 70 },
  },
  'integration-L3': {
    include: ['src/L2-clients/**/*.ts', 'src/L3-services/**/*.ts'],
    exclude: [...BASE_EXCLUDE, ...LLM_PROVIDERS],
    reportsDirectory: 'coverage/integration-L3',
    thresholds: { statements: 29, branches: 29, functions: 28, lines: 29 },
  },
  'integration-L4-L6': {
    include: ['src/L4-agents/**/*.ts', 'src/L5-assets/**/*.ts', 'src/L6-pipeline/**/*.ts'],
    exclude: [...BASE_EXCLUDE, ...LLM_PROVIDERS],
    reportsDirectory: 'coverage/integration-L4-L6',
    thresholds: { statements: 0, branches: 0, functions: 0, lines: 0 },
  },
  'integration-L7': {
    include: ['src/L7-app/**/*.ts'],
    exclude: [...BASE_EXCLUDE, ...L7_ENTRY_POINTS],
    reportsDirectory: 'coverage/integration-L7',
    thresholds: { statements: 67, branches: 55, functions: 65, lines: 67 },
  },
  e2e: {
    include: ['src/**/*.ts'],
    exclude: [...BASE_EXCLUDE, ...LLM_PROVIDERS, ...L7_ENTRY_POINTS],
    reportsDirectory: 'coverage/e2e',
    thresholds: { statements: 11, branches: 9, functions: 12, lines: 11 },
  },
}

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
        ? ['text', 'text-summary', 'json-summary']
        : ['text', 'text-summary', 'lcov', 'html', 'json-summary', 'json'],
      include: scope?.include ?? ['src/**/*.ts'],
      exclude: scope?.exclude ?? [...BASE_EXCLUDE, ...LLM_PROVIDERS, ...L7_ENTRY_POINTS],
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
