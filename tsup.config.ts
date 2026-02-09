import { defineConfig } from 'tsup'
import { copyFileSync, mkdirSync } from 'fs'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  // Keep node_modules external — they're runtime dependencies
  external: [
    // All dependencies are external (installed by npm)
    /^[^./]/,
  ],
  onSuccess: async () => {
    // Copy static assets for review server
    mkdirSync('dist/public', { recursive: true })
    copyFileSync('src/review/public/index.html', 'dist/public/index.html')
  },
})
