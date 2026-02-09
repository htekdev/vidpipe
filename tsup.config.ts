import { defineConfig } from 'tsup'
import { copyFileSync, mkdirSync, readdirSync } from 'fs'

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
    // Copy fonts for caption burning
    mkdirSync('dist/fonts', { recursive: true })
    const fontFiles = readdirSync('assets/fonts')
    for (const f of fontFiles) {
      copyFileSync(`assets/fonts/${f}`, `dist/fonts/${f}`)
    }
    // Copy face detection model
    mkdirSync('dist/models', { recursive: true })
    const modelFiles = readdirSync('assets/models')
    for (const f of modelFiles) {
      copyFileSync(`assets/models/${f}`, `dist/models/${f}`)
    }
  },
})
