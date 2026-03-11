import { describe, it, expect, afterEach } from 'vitest'
import { promises as fsp } from 'fs'
import os from 'os'
import { join } from 'path'
import {
  readJsonFile,
  readTextFile,
  listDirectory,
  writeJsonFile,
  writeTextFile,
  withTempDir,
  listFontFiles,
  moveFile,
  removeFile,
  copyFile,
} from '../../../L1-infra/fileSystem/fileSystem.js'

let tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'vant-fs-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const d of tempDirs) {
    await fsp.rm(d, { recursive: true, force: true }).catch(() => {})
  }
  tempDirs = []
})

describe('readJsonFile', () => {
  it('reads and parses valid JSON', async () => {
    const dir = await makeTempDir()
    const fp = join(dir, 'data.json')
    await fsp.writeFile(fp, JSON.stringify({ hello: 'world' }))
    const result = await readJsonFile<{ hello: string }>(fp)
    expect(result).toEqual({ hello: 'world' })
  })

  it('returns default value on ENOENT', async () => {
    const result = await readJsonFile('/no/such/file.json', { fallback: true })
    expect(result).toEqual({ fallback: true })
  })

  it('throws "File not found" on ENOENT without default', async () => {
    await expect(readJsonFile('/no/such/file.json')).rejects.toThrow('File not found')
  })

  it('throws "Failed to parse JSON" for invalid JSON', async () => {
    const dir = await makeTempDir()
    const fp = join(dir, 'bad.json')
    await fsp.writeFile(fp, '{ not valid json }')
    await expect(readJsonFile(fp)).rejects.toThrow('Failed to parse JSON')
  })
})

describe('readTextFile', () => {
  it('reads UTF-8 content', async () => {
    const dir = await makeTempDir()
    const fp = join(dir, 'hello.txt')
    await fsp.writeFile(fp, 'hello world', 'utf-8')
    const result = await readTextFile(fp)
    expect(result).toBe('hello world')
  })

  it('throws "File not found" on ENOENT', async () => {
    await expect(readTextFile('/no/such/file.txt')).rejects.toThrow('File not found')
  })
})

describe('listDirectory', () => {
  it('returns array of entries', async () => {
    const dir = await makeTempDir()
    await fsp.writeFile(join(dir, 'a.txt'), '')
    await fsp.writeFile(join(dir, 'b.txt'), '')
    const entries = await listDirectory(dir)
    expect(entries).toEqual(expect.arrayContaining(['a.txt', 'b.txt']))
  })

  it('throws "Directory not found" on ENOENT', async () => {
    await expect(listDirectory('/no/such/dir')).rejects.toThrow('Directory not found')
  })
})

describe('writeJsonFile', () => {
  it('creates parent dirs and writes valid JSON', async () => {
    const dir = await makeTempDir()
    const fp = join(dir, 'sub', 'deep', 'out.json')
    await writeJsonFile(fp, { key: 'value' })
    const raw = await fsp.readFile(fp, 'utf-8')
    expect(JSON.parse(raw)).toEqual({ key: 'value' })
  })
})

describe('writeTextFile', () => {
  it('creates file with content', async () => {
    const dir = await makeTempDir()
    const fp = join(dir, 'out.txt')
    await writeTextFile(fp, 'some text')
    const content = await fsp.readFile(fp, 'utf-8')
    expect(content).toBe('some text')
  })
})

describe('withTempDir', () => {
  it('creates temp dir, runs fn, cleans up after', async () => {
    let capturedDir = ''
    const result = await withTempDir('test-', async (dir) => {
      capturedDir = dir
      const stat = await fsp.stat(dir)
      expect(stat.isDirectory()).toBe(true)
      return 42
    })
    expect(result).toBe(42)
    await expect(fsp.stat(capturedDir)).rejects.toThrow()
  })

  it('cleans up even on error', async () => {
    let capturedDir = ''
    await expect(
      withTempDir('test-err-', async (dir) => {
        capturedDir = dir
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await expect(fsp.stat(capturedDir)).rejects.toThrow()
  })
})

describe('listFontFiles', () => {
  it('filters .ttf and .otf files', async () => {
    const dir = await makeTempDir()
    await fsp.writeFile(join(dir, 'font.ttf'), '')
    await fsp.writeFile(join(dir, 'font.otf'), '')
    await fsp.writeFile(join(dir, 'readme.md'), '')
    const fonts = await listFontFiles(dir)
    expect(fonts).toEqual(expect.arrayContaining(['font.ttf', 'font.otf']))
    expect(fonts).not.toContain('readme.md')
  })
})

describe('moveFile', () => {
  it('renames file', async () => {
    const dir = await makeTempDir()
    const src = join(dir, 'a.txt')
    const dest = join(dir, 'b.txt')
    await fsp.writeFile(src, 'data')
    await moveFile(src, dest)
    const content = await fsp.readFile(dest, 'utf-8')
    expect(content).toBe('data')
    await expect(fsp.stat(src)).rejects.toThrow()
  })
})

describe('removeFile', () => {
  it('silently ignores ENOENT', async () => {
    await expect(removeFile('/no/such/file.txt')).resolves.toBeUndefined()
  })
})

describe('copyFile', () => {
  it('creates parent dirs and copies', async () => {
    const dir = await makeTempDir()
    const src = join(dir, 'src.txt')
    const dest = join(dir, 'sub', 'dest.txt')
    await fsp.writeFile(src, 'copy me')
    await copyFile(src, dest)
    const content = await fsp.readFile(dest, 'utf-8')
    expect(content).toBe('copy me')
  })
})
