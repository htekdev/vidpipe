/**
 * E2E Test — L4 bridge wrappers export expected functions
 *
 * No mocking — verifies bridge wrappers are real functions.
 */
import { describe, test, expect } from 'vitest'
import {
  analyzeVideoEditorial, analyzeVideoClipDirection,
  analyzeVideoForEnhancements, transcribeVideo,
  generateCaptions, generateImage,
} from '../../L4-agents/analysisServiceBridge.js'
import {
  costTracker, markPending, markProcessing,
  markCompleted, markFailed, commitAndPush, buildPublishQueue,
} from '../../L4-agents/pipelineServiceBridge.js'

describe('E2E: L4 bridge wrappers', () => {
  test('analysisServiceBridge exports wrapper functions', () => {
    expect(typeof analyzeVideoEditorial).toBe('function')
    expect(typeof analyzeVideoClipDirection).toBe('function')
    expect(typeof analyzeVideoForEnhancements).toBe('function')
    expect(typeof transcribeVideo).toBe('function')
    expect(typeof generateCaptions).toBe('function')
    expect(typeof generateImage).toBe('function')
  })

  test('pipelineServiceBridge exports wrapper functions', () => {
    expect(typeof costTracker.reset).toBe('function')
    expect(typeof costTracker.setStage).toBe('function')
    expect(typeof costTracker.getReport).toBe('function')
    expect(typeof costTracker.formatReport).toBe('function')
    expect(typeof markPending).toBe('function')
    expect(typeof markProcessing).toBe('function')
    expect(typeof markCompleted).toBe('function')
    expect(typeof markFailed).toBe('function')
    expect(typeof commitAndPush).toBe('function')
    expect(typeof buildPublishQueue).toBe('function')
  })
})
