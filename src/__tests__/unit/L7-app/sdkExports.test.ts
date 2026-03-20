/**
 * Unit test — SDK entry point exports and factory shape.
 *
 * Verifies createVidPipe returns an object with the expected namespace
 * structure without invoking any L3 services (no mocking needed —
 * factory returns a structural facade, methods are lazy).
 */
import { describe, it, expect } from 'vitest'

import { createVidPipe } from '../../../L7-app/sdk/VidPipeSDK.js'

describe('SDK exports', () => {
  it('createVidPipe returns object with all expected namespaces', () => {
    const sdk = createVidPipe()
    expect(typeof sdk.processVideo).toBe('function')
    expect(typeof sdk.ideate).toBe('function')
    expect(typeof sdk.doctor).toBe('function')
    expect(sdk.ideas).toBeDefined()
    expect(sdk.schedule).toBeDefined()
    expect(sdk.video).toBeDefined()
    expect(sdk.social).toBeDefined()
    expect(sdk.config).toBeDefined()
  })

  it('ideas namespace has CRUD methods', () => {
    const sdk = createVidPipe()
    expect(typeof sdk.ideas.list).toBe('function')
    expect(typeof sdk.ideas.get).toBe('function')
    expect(typeof sdk.ideas.create).toBe('function')
    expect(typeof sdk.ideas.update).toBe('function')
  })

  it('schedule namespace has expected methods', () => {
    const sdk = createVidPipe()
    expect(typeof sdk.schedule.loadConfig).toBe('function')
  })

  it('video namespace has expected methods', () => {
    const sdk = createVidPipe()
    expect(typeof sdk.video.extractClip).toBe('function')
    expect(typeof sdk.video.burnCaptions).toBe('function')
    expect(typeof sdk.video.detectSilence).toBe('function')
    expect(typeof sdk.video.generateVariants).toBe('function')
    expect(typeof sdk.video.captureFrame).toBe('function')
  })

  it('config namespace has expected methods', () => {
    const sdk = createVidPipe()
    expect(typeof sdk.config.get).toBe('function')
    expect(typeof sdk.config.getAll).toBe('function')
    expect(typeof sdk.config.getGlobal).toBe('function')
    expect(typeof sdk.config.set).toBe('function')
    expect(typeof sdk.config.save).toBe('function')
    expect(typeof sdk.config.path).toBe('function')
  })
})
