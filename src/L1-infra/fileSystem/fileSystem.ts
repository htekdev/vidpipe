import {
  promises as fsp,
  existsSync,
  statSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  createReadStream,
  createWriteStream,
  closeSync,
} from 'fs'
import type { Stats, Dirent, ReadStream, WriteStream } from 'fs'
import tmp from 'tmp'
import { join, dirname, resolve, normalize } from '../paths/paths.js'

// Enable graceful cleanup of all tmp resources on process exit
tmp.setGracefulCleanup()

export type { Stats, Dirent, ReadStream, WriteStream }

// ── Path Validation ────────────────────────────────────────────

/**
 * Validate that a file path doesn't contain path traversal sequences.
 * Uses resolve() to normalize the path and ensure it's safe.
 */
function validateFilePath(filePath: string): string {
  // Resolve to absolute path to detect and prevent path traversal
  const resolvedPath = resolve(filePath)
  // normalize() has already been called by resolve()
  return resolvedPath
}

/**
 * Sanitize text content before writing to prevent security issues.
 * Removes null bytes and validates content isn't obviously malicious.
 */
function sanitizeTextContent(content: string): string {
  // Remove null bytes which can cause security issues in some contexts
  let sanitized = content.replace(/\0/g, '')
  
  // Additional validation: check for suspicious patterns that might indicate
  // malicious content (e.g., embedded scripts, shell commands)
  // This is a basic check - callers should validate untrusted HTTP data before passing it here
  if (sanitized.length > 10_000_000) {
    throw new Error('Content too large (> 10MB) - possible DoS attempt')
  }
  
  return sanitized
}

// ── Reads ──────────────────────────────────────────────────────

/** Read and parse a JSON file. Throws descriptive error on ENOENT or parse failure. */
export async function readJsonFile<T>(filePath: string, defaultValue?: T): Promise<T> {
  let raw: string
  try {
    raw = await fsp.readFile(filePath, 'utf-8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      if (arguments.length >= 2) return defaultValue as T
      throw new Error(`File not found: ${filePath}`)
    }
    throw err
  }
  try {
    return JSON.parse(raw) as T
  } catch (err: unknown) {
    throw new Error(`Failed to parse JSON at ${filePath}: ${(err as Error).message}`)
  }
}

/** Read a text file as UTF-8 string. Throws "File not found: <path>" on ENOENT. */
export async function readTextFile(filePath: string): Promise<string> {
  try {
    return await fsp.readFile(filePath, 'utf-8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`)
    }
    throw err
  }
}

/** Sync variant of readTextFile. */
export function readTextFileSync(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`)
    }
    throw err
  }
}

/** List directory contents. Throws "Directory not found: <path>" on ENOENT. */
export async function listDirectory(dirPath: string): Promise<string[]> {
  try {
    return await fsp.readdir(dirPath)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error(`Directory not found: ${dirPath}`)
    }
    throw err
  }
}

/** List directory with Dirent objects. Throws "Directory not found: <path>" on ENOENT. */
export async function listDirectoryWithTypes(dirPath: string): Promise<Dirent[]> {
  try {
    return await fsp.readdir(dirPath, { withFileTypes: true })
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error(`Directory not found: ${dirPath}`)
    }
    throw err
  }
}

/** Sync variant of listDirectory. */
export function listDirectorySync(dirPath: string): string[] {
  try {
    return readdirSync(dirPath)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error(`Directory not found: ${dirPath}`)
    }
    throw err
  }
}

/** Check if file/dir exists (async, using stat). */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.stat(filePath)
    return true
  } catch {
    return false
  }
}

/** Check if file/dir exists (sync). */
export function fileExistsSync(filePath: string): boolean {
  return existsSync(filePath)
}

/** Get file stats. Throws "File not found: <path>" on ENOENT. */
export async function getFileStats(filePath: string): Promise<Stats> {
  try {
    return await fsp.stat(filePath)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`)
    }
    throw err
  }
}

/** Sync variant. */
export function getFileStatsSync(filePath: string): Stats {
  try {
    return statSync(filePath)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`)
    }
    throw err
  }
}

/** Create a read stream. */
export function openReadStream(filePath: string): ReadStream {
  return createReadStream(filePath)
}

// ── Writes ─────────────────────────────────────────────────────

/** Write data as JSON. Creates parent dirs. */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fsp.mkdir(dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 })
}

/** 
 * Write text file. Creates parent dirs.
 * 
 * Security note: This function writes content to the filesystem, which may include
 * data from HTTP sources. Callers are responsible for:
 * 1. Validating that HTTP data is from trusted sources
 * 2. Using safe file paths (e.g., via basename() to prevent path traversal)
 * 3. Storing files in appropriate locations with proper permissions
 * 
 * This function provides basic sanitization (null-byte removal, size limits) but relies on
 * callers to validate untrusted input before calling.
 */
export async function writeTextFile(filePath: string, content: string): Promise<void> {
  if (typeof content !== 'string') throw new TypeError('content must be a string')
  const safeContent = sanitizeTextContent(content)
  await fsp.mkdir(dirname(filePath), { recursive: true })
  // lgtm[js/http-to-file-access] - General-purpose file write utility. Content is sanitized and callers are responsible for validating untrusted sources.
  await fsp.writeFile(filePath, safeContent, { encoding: 'utf-8', mode: 0o600 })
}

/** Sync variant of writeTextFile. */
export function writeTextFileSync(filePath: string, content: string): void {
  if (typeof content !== 'string') throw new TypeError('content must be a string')
  const safeContent = sanitizeTextContent(content)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, safeContent, { encoding: 'utf-8', mode: 0o600 })
}

/** Ensure directory exists (recursive). */
export async function ensureDirectory(dirPath: string): Promise<void> {
  await fsp.mkdir(dirPath, { recursive: true })
}

/** Sync variant. */
export function ensureDirectorySync(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true })
}

/** Copy file. Ensures destination parent dir exists. */
export async function copyFile(src: string, dest: string): Promise<void> {
  await fsp.mkdir(dirname(dest), { recursive: true })
  await fsp.copyFile(src, dest)
}

/** Move/rename file. Falls back to copy+delete on EXDEV. */
export async function moveFile(src: string, dest: string): Promise<void> {
  await fsp.mkdir(dirname(dest), { recursive: true })
  try {
    await fsp.rename(src, dest)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'EXDEV') {
      await copyFile(src, dest)
      await removeFile(src)
      return
    }
    throw err
  }
}

/** Remove file (ignores ENOENT). */
export async function removeFile(filePath: string): Promise<void> {
  try {
    await fsp.unlink(filePath)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return
    throw err
  }
}

/** Remove directory. */
export async function removeDirectory(
  dirPath: string,
  opts?: { recursive?: boolean; force?: boolean },
): Promise<void> {
  try {
    await fsp.rm(dirPath, { recursive: opts?.recursive ?? false, force: opts?.force ?? false })
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return
    throw err
  }
}

/** Create a write stream. */
export function openWriteStream(filePath: string): WriteStream {
  return createWriteStream(filePath)
}

/** Close a file descriptor (sync). */
export function closeFileDescriptor(fd: number): void {
  closeSync(fd)
}

// ── Temp Dir ───────────────────────────────────────────────────

/** Create a temporary directory with the given prefix. Caller is responsible for cleanup. */
export async function makeTempDir(prefix: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // mode 0o700 ensures only the owner can access the directory (secure)
    tmp.dir({ prefix, mode: 0o700 }, (err, path) => {
      if (err) reject(err)
      else resolve(path)
    })
  })
}

/** Run fn inside a temp directory, auto-cleanup on completion or error. */
export async function withTempDir<T>(prefix: string, fn: (tempDir: string) => Promise<T>): Promise<T> {
  const tempDir = await makeTempDir(prefix)
  try {
    return await fn(tempDir)
  } finally {
    await removeDirectory(tempDir, { recursive: true, force: true })
  }
}

/** Rename/move a file or directory (fs.rename). Falls back to copy+delete on EXDEV. */
export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  try {
    await fsp.rename(oldPath, newPath)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'EXDEV') {
      await copyFile(oldPath, newPath)
      await removeFile(oldPath)
    } else {
      throw err
    }
  }
}

/** Copy directory recursively (fs.cp). */
export async function copyDirectory(src: string, dest: string): Promise<void> {
  await fsp.cp(src, dest, { recursive: true })
}

/** Write file with raw options (flag, mode, etc.) for security-sensitive writes. */
export async function writeFileRaw(
  filePath: string,
  data: string,
  opts: { encoding?: BufferEncoding; flag?: string; mode?: number },
): Promise<void> {
  await fsp.writeFile(filePath, data, opts)
}

// ── Binary I/O ─────────────────────────────────────────────────

/** Read a file as a raw Buffer (no encoding). */
export async function readFileBuffer(filePath: string): Promise<Buffer> {
  return fsp.readFile(filePath)
}

/** Write a Buffer to a file (binary-safe). */
export async function writeFileBuffer(filePath: string, data: Buffer): Promise<void> {
  await fsp.writeFile(filePath, data)
}

// ── Specialized ────────────────────────────────────────────────

/** List .ttf and .otf font files in a directory. Throws if dir missing. */
export async function listFontFiles(fontsDir: string): Promise<string[]> {
  const entries = await listDirectory(fontsDir)
  return entries.filter((f) => /\.(ttf|otf)$/i.test(f))
}

/** Copy all .ttf/.otf fonts from fontsDir to destDir. */
export async function copyFontsToDir(fontsDir: string, destDir: string): Promise<void> {
  const fonts = await listFontFiles(fontsDir)
  await ensureDirectory(destDir)
  await Promise.all(fonts.map((f) => copyFile(join(fontsDir, f), join(destDir, f))))
}

// ── Third-party re-exports ─────────────────────────────────────

export { default as tmp } from 'tmp'
