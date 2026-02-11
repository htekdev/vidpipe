import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'html', 'json-summary', 'json'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/index.ts', // CLI entry point
        'src/commands/init.ts', // CLI command handler — interactive prompts
        'src/commands/schedule.ts', // CLI command handler — interactive prompts
        'src/providers/CopilotProvider.ts', // SDK wrappers — require real API keys to test
        'src/providers/OpenAIProvider.ts',
        'src/providers/ClaudeProvider.ts',
        'src/providers/types.ts', // Pure type definitions — no runtime code
      ],
      thresholds: {
        statements: 70,
        branches: 64,
        functions: 70,
        lines: 70,
      },
    },
    testTimeout: 30000,
  },
});
