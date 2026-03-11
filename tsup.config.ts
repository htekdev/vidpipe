import { defineConfig } from 'tsup'
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs'

export default defineConfig({
  entry: ['src/L7-app/cli.ts'],
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
    copyFileSync('src/L7-app/review/public/index.html', 'dist/public/index.html')
    // Copy fonts for caption burning
    mkdirSync('dist/fonts', { recursive: true })
    const fontFiles = readdirSync('assets/fonts').filter(f => statSync(`assets/fonts/${f}`).isFile())
    for (const f of fontFiles) {
      copyFileSync(`assets/fonts/${f}`, `dist/fonts/${f}`)
    }
    // Copy face detection model (only ultraface, not unused large models)
    mkdirSync('dist/models', { recursive: true })
    copyFileSync('assets/models/ultraface-320.onnx', 'dist/models/ultraface-320.onnx')
  },
})
