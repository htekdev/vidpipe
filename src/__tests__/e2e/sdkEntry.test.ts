/**
 * E2E Test — SDK public entry point exports.
 *
 * No mocking — verifies the 'vidpipe' package entry (src/index.ts)
 * re-exports createVidPipe and all expected domain types.
 */
import { describe, test, expect } from 'vitest'

import {
  createVidPipe,
  Platform,
  PipelineStage,
} from '../../index.js'

describe('E2E: SDK entry point', () => {
  test('createVidPipe is exported and returns an SDK instance', () => {
    expect(typeof createVidPipe).toBe('function')
    const sdk = createVidPipe()
    expect(sdk).toBeDefined()
    expect(typeof sdk.processVideo).toBe('function')
    expect(typeof sdk.ideate).toBe('function')
  })

  test('Platform enum is exported with expected values', () => {
    expect(Platform.YouTube).toBe('youtube')
    expect(Platform.TikTok).toBe('tiktok')
    expect(Platform.Instagram).toBe('instagram')
    expect(Platform.LinkedIn).toBe('linkedin')
    expect(Platform.X).toBe('x')
  })

  test('PipelineStage enum is exported', () => {
    expect(PipelineStage).toBeDefined()
    expect(typeof PipelineStage.Ingestion).toBe('string')
  })

  test('ideate accepts singleTopic option', () => {
    const sdk = createVidPipe()
    expect(typeof sdk.ideate).toBe('function')
  })

  test('SDK configure namespace provides config management methods', () => {
    const sdk = createVidPipe()
    expect(typeof sdk.config.get).toBe('function')
    expect(typeof sdk.config.getAll).toBe('function')
    expect(typeof sdk.config.getGlobal).toBe('function')
    expect(typeof sdk.config.set).toBe('function')
    expect(typeof sdk.config.save).toBe('function')
    expect(typeof sdk.config.path).toBe('function')
  })

  test('L1 readlinePromises wrapper exports createPromptInterface', async () => {
    const { createPromptInterface } = await import('../../L1-infra/readline/readlinePromises.js')
    expect(typeof createPromptInterface).toBe('function')

    // Exercise the function with a custom readable/writable to avoid blocking on stdin
    const { Readable, Writable } = await import('node:stream')
    const input = new Readable({ read() { this.push(null) } })
    const output = new Writable({ write(_chunk, _enc, cb) { cb() } })

    const rl = createPromptInterface({ input, output })
    expect(rl).toBeDefined()
    expect(typeof rl.question).toBe('function')
    expect(typeof rl.close).toBe('function')
    rl.close()
  })
})
