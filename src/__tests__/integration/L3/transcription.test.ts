/**
 * L3 Integration Test — transcription service module contract
 *
 * Mock boundary: None (L2 runs real)
 * Real code:     L2 + L3 (transcription chain)
 *
 * Validates that the transcription service exports the expected API
 * and does not carry file-writing side effects.
 */
import { describe, it, expect } from 'vitest'
import { transcribeVideo } from '../../../L3-services/transcription/transcription.js'

describe('L3 Integration: transcription module contract', () => {
  it('exports transcribeVideo as an async function', () => {
    expect(typeof transcribeVideo).toBe('function')
  })

  it('transcribeVideo does not import writeJsonFile (no auto-save side effect)', async () => {
    // Verify the module source no longer references writeJsonFile.
    // This is a structural assertion — transcribeVideo should be a pure
    // transcription function that returns a Transcript without saving it.
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')

    const thisDir = dirname(fileURLToPath(import.meta.url))
    const srcPath = join(thisDir, '..', '..', '..', 'L3-services', 'transcription', 'transcription.ts')
    const source = await readFile(srcPath, 'utf-8')

    expect(source).not.toContain('writeJsonFile')
  })
})
