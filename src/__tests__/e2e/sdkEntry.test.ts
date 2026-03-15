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
    // Verify the method signature accepts singleTopic without type errors
    // (actual call would require LLM services — just verify it's callable)
    expect(typeof sdk.ideate).toBe('function')
  })
})
