import { defineConfig } from 'tsup'
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs'

const shared = {
  format: ['esm'] as const,
  target: 'node20' as const,
  platform: 'node' as const,
  outDir: 'dist',
  splitting: false,
  sourcemap: true,
  dts: true,
  external: [
    // All dependencies are external (installed by npm)
    /^[^./]/,
  ],
}

export default defineConfig([
  {
    ...shared,
    entry: { cli: 'src/L7-app/cli.ts' },
    banner: { js: '#!/usr/bin/env node' },
    clean: true,
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
  },
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    clean: false,
  },
])
