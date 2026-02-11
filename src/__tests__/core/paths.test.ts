import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import {
  join,
  resolve,
  dirname,
  basename,
  extname,
  projectRoot,
  fontsDir,
  assetsDir,
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
})

describe('fontsDir', () => {
  it('returns a string path', () => {
    expect(typeof fontsDir()).toBe('string')
  })
})

describe('assetsDir', () => {
  it('returns path ending with assets/fonts or assets\\fonts', () => {
    const result = assetsDir('fonts')
    expect(result).toMatch(/assets[/\\]fonts$/)
  })
})
