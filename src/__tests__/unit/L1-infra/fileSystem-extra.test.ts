import { describe, it, expect, afterEach } from 'vitest'
import { promises as fsp } from 'fs'
import os from 'os'
import { join } from 'path'
import {
  readTextFileSync,
  listDirectorySync,
  listDirectoryWithTypes,
  fileExists,
  fileExistsSync,
  getFileStats,
  getFileStatsSync,
  writeTextFile,
  writeTextFileSync,
  ensureDirectory,
  ensureDirectorySync,
  removeFile,
  removeDirectory,
  renameFile,
  copyFontsToDir,
  makeTempDir,
  writeFileRaw,
  copyDirectory,
  openReadStream,
  openWriteStream,
  closeFileDescriptor,
} from '../../../L1-infra/fileSystem/fileSystem.js'

let tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await fsp.mkdtemp(join(os.tmpdir(), 'vant-fs-extra-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const d of tempDirs) {
    await fsp.rm(d, { recursive: true, force: true }).catch(() => {})
  }
  tempDirs = []
})

// ── readTextFileSync ────────────────────────────────────────────

describe('readTextFileSync', () => {
  it('reads UTF-8 content synchronously', async () => {
    const dir = await createTempDir()
    const fp = join(dir, 'sync.txt')
    await fsp.writeFile(fp, 'sync content', 'utf-8')
    expect(readTextFileSync(fp)).toBe('sync content')
  })

  it('throws "File not found" on ENOENT', () => {
    expect(() => readTextFileSync('/no/such/sync.txt')).toThrow('File not found')
  })
})

// ── listDirectorySync ───────────────────────────────────────────

describe('listDirectorySync', () => {
  it('returns entries synchronously', async () => {
    const dir = await createTempDir()
    await fsp.writeFile(join(dir, 'x.txt'), '')
    const entries = listDirectorySync(dir)
    expect(entries).toContain('x.txt')
  })

  it('throws "Directory not found" on ENOENT', () => {
    expect(() => listDirectorySync('/no/such/dir')).toThrow('Directory not found')
  })
})

// ── listDirectoryWithTypes ──────────────────────────────────────

describe('listDirectoryWithTypes', () => {
  it('returns Dirent objects', async () => {
    const dir = await createTempDir()
    await fsp.writeFile(join(dir, 'file.txt'), '')
    await fsp.mkdir(join(dir, 'subdir'))
    const entries = await listDirectoryWithTypes(dir)
    const names = entries.map((e) => e.name)
    expect(names).toContain('file.txt')
    expect(names).toContain('subdir')
    const fileEntry = entries.find((e) => e.name === 'file.txt')!
    expect(fileEntry.isFile()).toBe(true)
    const dirEntry = entries.find((e) => e.name === 'subdir')!
    expect(dirEntry.isDirectory()).toBe(true)
  })

  it('throws "Directory not found" on ENOENT', async () => {
    await expect(listDirectoryWithTypes('/no/such/dir')).rejects.toThrow('Directory not found')
  })
})

// ── fileExists / fileExistsSync ─────────────────────────────────

describe('fileExists', () => {
  it('returns true for existing file', async () => {
    const dir = await createTempDir()
    const fp = join(dir, 'exists.txt')
    await fsp.writeFile(fp, '')
    expect(await fileExists(fp)).toBe(true)
  })

  it('returns false for missing file', async () => {
    expect(await fileExists('/no/such/file.txt')).toBe(false)
  })
})

describe('fileExistsSync', () => {
  it('returns true for existing file', async () => {
    const dir = await createTempDir()
    const fp = join(dir, 'exists.txt')
    await fsp.writeFile(fp, '')
    expect(fileExistsSync(fp)).toBe(true)
  })

  it('returns false for missing file', () => {
    expect(fileExistsSync('/no/such/file.txt')).toBe(false)
  })
})

// ── getFileStats / getFileStatsSync ─────────────────────────────

describe('getFileStats', () => {
  it('returns Stats for existing file', async () => {
    const dir = await createTempDir()
    const fp = join(dir, 'stat.txt')
    await fsp.writeFile(fp, 'hello')
    const stats = await getFileStats(fp)
    expect(stats.isFile()).toBe(true)
    expect(stats.size).toBe(5)
  })

  it('throws "File not found" on ENOENT', async () => {
    await expect(getFileStats('/no/such/file.txt')).rejects.toThrow('File not found')
  })
})

describe('getFileStatsSync', () => {
  it('returns Stats synchronously', async () => {
    const dir = await createTempDir()
    const fp = join(dir, 'stat-sync.txt')
    await fsp.writeFile(fp, 'world')
    const stats = getFileStatsSync(fp)
    expect(stats.isFile()).toBe(true)
  })

  it('throws "File not found" on ENOENT', () => {
    expect(() => getFileStatsSync('/no/such/file.txt')).toThrow('File not found')
  })
})

// ── writeTextFileSync ───────────────────────────────────────────

describe('writeTextFileSync', () => {
  it('writes content synchronously with parent dirs', async () => {
    const dir = await createTempDir()
    const fp = join(dir, 'deep', 'sync-out.txt')
    writeTextFileSync(fp, 'sync write')
    const content = await fsp.readFile(fp, 'utf-8')
    expect(content).toBe('sync write')
  })

  it('throws TypeError for non-string content', () => {
    expect(() => writeTextFileSync('/tmp/nope.txt', 123 as unknown as string)).toThrow(
      'content must be a string',
    )
  })
})

// ── ensureDirectory / ensureDirectorySync ───────────────────────

describe('ensureDirectory', () => {
  it('creates nested directories', async () => {
    const dir = await createTempDir()
    const deep = join(dir, 'a', 'b', 'c')
    await ensureDirectory(deep)
    const stat = await fsp.stat(deep)
    expect(stat.isDirectory()).toBe(true)
  })
})

describe('ensureDirectorySync', () => {
  it('creates nested directories synchronously', async () => {
    const dir = await createTempDir()
    const deep = join(dir, 'd', 'e', 'f')
    ensureDirectorySync(deep)
    const stat = await fsp.stat(deep)
    expect(stat.isDirectory()).toBe(true)
  })
})

// ── removeFile ──────────────────────────────────────────────────

describe('removeFile', () => {
  it('removes an existing file', async () => {
    const dir = await createTempDir()
    const fp = join(dir, 'to-remove.txt')
    await fsp.writeFile(fp, 'bye')
    await removeFile(fp)
    await expect(fsp.stat(fp)).rejects.toThrow()
  })
})

// ── removeDirectory ─────────────────────────────────────────────

describe('removeDirectory', () => {
  it('removes directory recursively', async () => {
    const dir = await createTempDir()
    const sub = join(dir, 'removeme')
    await fsp.mkdir(sub)
    await fsp.writeFile(join(sub, 'file.txt'), '')
    await removeDirectory(sub, { recursive: true })
    await expect(fsp.stat(sub)).rejects.toThrow()
  })

  it('silently ignores ENOENT', async () => {
    await expect(removeDirectory('/no/such/dir')).resolves.toBeUndefined()
  })

  it('removes with force option', async () => {
    const dir = await createTempDir()
    const sub = join(dir, 'force-rm')
    await fsp.mkdir(sub)
    await removeDirectory(sub, { recursive: true, force: true })
    await expect(fsp.stat(sub)).rejects.toThrow()
  })
})

// ── renameFile ──────────────────────────────────────────────────

describe('renameFile', () => {
  it('renames a file in the same directory', async () => {
    const dir = await createTempDir()
    const old = join(dir, 'old.txt')
    const nu = join(dir, 'new.txt')
    await fsp.writeFile(old, 'renamed')
    await renameFile(old, nu)
    expect(await fsp.readFile(nu, 'utf-8')).toBe('renamed')
    await expect(fsp.stat(old)).rejects.toThrow()
  })
})

// ── makeTempDir ─────────────────────────────────────────────────

describe('makeTempDir', () => {
  it('creates a temp directory with given prefix', async () => {
    const dir = await makeTempDir('vant-test-')
    tempDirs.push(dir)
    const stat = await fsp.stat(dir)
    expect(stat.isDirectory()).toBe(true)
    expect(dir).toContain('vant-test-')
  })
})

// ── copyFontsToDir ──────────────────────────────────────────────

describe('copyFontsToDir', () => {
  it('copies only .ttf and .otf files', async () => {
    const src = await createTempDir()
    const dest = await createTempDir()
    const destSub = join(dest, 'fonts-copy')
    await fsp.writeFile(join(src, 'font.ttf'), 'ttf data')
    await fsp.writeFile(join(src, 'font.otf'), 'otf data')
    await fsp.writeFile(join(src, 'readme.md'), 'ignore me')
    await copyFontsToDir(src, destSub)
    const entries = await fsp.readdir(destSub)
    expect(entries).toContain('font.ttf')
    expect(entries).toContain('font.otf')
    expect(entries).not.toContain('readme.md')
  })
})

// ── writeFileRaw ────────────────────────────────────────────────

describe('writeFileRaw', () => {
  it('writes file with custom flags', async () => {
    const dir = await createTempDir()
    const fp = join(dir, 'raw.txt')
    await writeFileRaw(fp, 'raw content', { encoding: 'utf-8', flag: 'w' })
    expect(await fsp.readFile(fp, 'utf-8')).toBe('raw content')
  })
})

// ── copyDirectory ───────────────────────────────────────────────

describe('copyDirectory', () => {
  it('copies directory recursively', async () => {
    const src = await createTempDir()
    const dest = await createTempDir()
    const destSub = join(dest, 'copy-target')
    await fsp.mkdir(join(src, 'sub'))
    await fsp.writeFile(join(src, 'a.txt'), 'aa')
    await fsp.writeFile(join(src, 'sub', 'b.txt'), 'bb')
    await copyDirectory(src, destSub)
    expect(await fsp.readFile(join(destSub, 'a.txt'), 'utf-8')).toBe('aa')
    expect(await fsp.readFile(join(destSub, 'sub', 'b.txt'), 'utf-8')).toBe('bb')
  })
})

// ── writeTextFile (async) ───────────────────────────────────────

describe('writeTextFile', () => {
  it('throws TypeError for non-string content', async () => {
    await expect(writeTextFile('/tmp/nope.txt', 123 as unknown as string)).rejects.toThrow(
      'content must be a string',
    )
  })

  it('writes content to file', async () => {
    const dir = await createTempDir()
    const fp = join(dir, 'async-write.txt')
    await writeTextFile(fp, 'async content')
    expect(await fsp.readFile(fp, 'utf-8')).toBe('async content')
  })
})

// ── removeDirectory defaults ────────────────────────────────────

describe('removeDirectory (defaults)', () => {
  it('removes directory with only force option', async () => {
    const dir = await createTempDir()
    const sub = join(dir, 'forceonly')
    await fsp.mkdir(sub)
    await removeDirectory(sub, { recursive: true, force: true })
    await expect(fsp.stat(sub)).rejects.toThrow()
  })
})

// ── openReadStream / openWriteStream / closeFileDescriptor ──────

describe('openReadStream', () => {
  it('returns a readable stream', async () => {
    const dir = await createTempDir()
    const fp = join(dir, 'stream.txt')
    await fsp.writeFile(fp, 'stream data')
    const stream = openReadStream(fp)
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer)
    }
    expect(Buffer.concat(chunks).toString()).toBe('stream data')
  })
})

describe('openWriteStream', () => {
  it('returns a writable stream', async () => {
    const dir = await createTempDir()
    const fp = join(dir, 'write-stream.txt')
    const stream = openWriteStream(fp)
    stream.write('written')
    await new Promise<void>((resolve) => stream.end(resolve))
    expect(await fsp.readFile(fp, 'utf-8')).toBe('written')
  })
})

describe('closeFileDescriptor', () => {
  it('closes a valid file descriptor', async () => {
    const dir = await createTempDir()
    const fp = join(dir, 'fd.txt')
    await fsp.writeFile(fp, '')
    const fh = await fsp.open(fp, 'r')
    closeFileDescriptor(fh.fd)
  })
})
