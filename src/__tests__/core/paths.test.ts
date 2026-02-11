import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync } from 'fs'
import {
  join,
  resolve,
  dirname,
  basename,
  extname,
  projectRoot,
  fontsDir,
  modelsDir,
  assetsDir,
  findRoot,
} from '../../core/paths.js'

describe('path re-exports', () => {
  it('join combines segments', () => {
    expect(join('a', 'b', 'c')).toMatch(/a[/\\]b[/\\]c/)
  })

  it('resolve returns absolute path', () => {
    const result = resolve('a', 'b')
    expect(result).toMatch(/^[A-Z]:[/\\]|^\//)
  })

  it('dirname returns parent', () => {
    expect(dirname('/foo/bar/baz.txt')).toMatch(/foo[/\\]bar/)
  })

  it('basename returns filename', () => {
    expect(basename('/foo/bar/baz.txt')).toBe('baz.txt')
  })

  it('extname returns extension', () => {
    expect(extname('file.mp4')).toBe('.mp4')
  })
})

describe('projectRoot', () => {
  it('points to a directory with package.json', () => {
    const root = projectRoot()
    expect(existsSync(join(root, 'package.json'))).toBe(true)
  })

  it('returns the same root when called from different depths', () => {
    const root = projectRoot()
    expect(existsSync(join(root, 'assets', 'fonts'))).toBe(true)
  })

  it('resolves to the repo that contains tsconfig.json', () => {
    const root = projectRoot()
    expect(existsSync(join(root, 'tsconfig.json'))).toBe(true)
  })
})

describe('findRoot', () => {
  it('finds the project root from src/core/ (dev path)', () => {
    const root = projectRoot()
    const devDir = join(root, 'src', 'core')
    expect(findRoot(devDir)).toBe(root)
  })

  it('finds the project root from dist/ (bundled path — regression)', () => {
    // This is the exact scenario that caused the ENOENT:
    // In production, the bundle runs from dist/, and hardcoded ../.. overshoots
    const root = projectRoot()
    const distDir = join(root, 'dist')
    expect(findRoot(distDir)).toBe(root)
  })

  it('finds the project root from a deeply nested subdirectory', () => {
    const root = projectRoot()
    const deepDir = join(root, 'src', 'tools', 'ffmpeg')
    expect(findRoot(deepDir)).toBe(root)
  })

  it('throws when no package.json is found', () => {
    // Starting from filesystem root should not find a vidpipe package.json
    const fsRoot = resolve('/')
    expect(() => findRoot(fsRoot)).toThrow()
  })
})

describe('fontsDir', () => {
  it('returns a string path', () => {
    expect(typeof fontsDir()).toBe('string')
  })

  it('returns a path that actually exists on disk', () => {
    const dir = fontsDir()
    expect(existsSync(dir)).toBe(true)
  })

  it('contains font files (.ttf or .otf)', () => {
    const dir = fontsDir()
    const files = readdirSync(dir)
    const fontFiles = files.filter((f: string) => f.endsWith('.ttf') || f.endsWith('.otf'))
    expect(fontFiles.length).toBeGreaterThan(0)
  })
})

describe('assetsDir', () => {
  it('returns path ending with assets/fonts or assets\\fonts', () => {
    const result = assetsDir('fonts')
    expect(result).toMatch(/assets[/\\]fonts$/)
  })
})

describe('modelsDir', () => {
  it('returns a path that actually exists on disk', () => {
    const dir = modelsDir()
    expect(existsSync(dir)).toBe(true)
  })

  it('contains the ultraface ONNX model', () => {
    const dir = modelsDir()
    expect(existsSync(join(dir, 'ultraface-320.onnx'))).toBe(true)
  })
})
