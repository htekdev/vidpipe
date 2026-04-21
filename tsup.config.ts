import { defineConfig } from 'tsup'
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs'

// vscode-jsonrpc is CJS and uses require() for Node builtins (util, path, etc.).
// When bundled into ESM, esbuild's CJS shim checks `typeof require !== "undefined"`
// before throwing. This banner provides a real require() so the shim succeeds.
const CJS_SHIM = 'import{createRequire as __cjsRequire}from"module";const require=__cjsRequire(import.meta.url);'

const shared = {
  format: ['esm'] as const,
  target: 'node20' as const,
  platform: 'node' as const,
  outDir: 'dist',
  splitting: false,
  sourcemap: true,
  dts: true,
  external: [
    // Dependencies are external (installed by npm) unless listed in noExternal.
    /^[^./]/,
  ],
  // @github/copilot-sdk imports "vscode-jsonrpc/node" (no .js extension), but
  // vscode-jsonrpc is CJS-only with no "exports" map, so Node's ESM resolver
  // cannot find the subpath at runtime (ERR_MODULE_NOT_FOUND). Bundling both
  // packages lets esbuild resolve the import at build time and convert CJS→ESM.
  noExternal: ['@github/copilot-sdk', 'vscode-jsonrpc'],
}

export default defineConfig([
  {
    ...shared,
    entry: { cli: 'src/L7-app/cli.ts' },
    banner: { js: `#!/usr/bin/env node\n${CJS_SHIM}` },
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
    banner: { js: CJS_SHIM },
    clean: false,
  },
])
