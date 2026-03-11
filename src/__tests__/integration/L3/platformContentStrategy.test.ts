/**
 * L3 Integration Test — platformContentStrategy
 *
 * Mock boundary: L1 infrastructure (logger — auto-mocked by setup.ts)
 * Real code:     L3 platformContentStrategy, L0 pure types (Platform)
 *
 * Validates content matrix completeness and cross-platform consistency.
 */
import { describe, it, expect } from 'vitest'
import { Platform } from '../../../L0-pure/types/index.js'
import {
  getMediaRule,
  platformAcceptsMedia,
} from '../../../L3-services/socialPosting/platformContentStrategy.js'

describe('L3 Integration: platformContentStrategy', () => {

  describe('LinkedIn content strategy', () => {
    it('accepts shorts with captioned original variant', () => {
      const rule = getMediaRule(Platform.LinkedIn, 'short')
      expect(rule).not.toBeNull()
      expect(rule!.captions).toBe(true)
      expect(rule!.variantKey).toBeNull()
    })

    it('accepts medium-clips with captioned original variant', () => {
      const rule = getMediaRule(Platform.LinkedIn, 'medium-clip')
      expect(rule).not.toBeNull()
      expect(rule!.captions).toBe(true)
      expect(rule!.variantKey).toBeNull()
    })

    it('rejects full video as text-only', () => {
      expect(platformAcceptsMedia(Platform.LinkedIn, 'video')).toBe(false)
    })
  })

  describe('cross-platform short support', () => {
    const platformsWithShorts = [
      Platform.YouTube,
      Platform.TikTok,
      Platform.Instagram,
      Platform.X,
      Platform.LinkedIn,
    ]

    it.each(platformsWithShorts)('%s accepts shorts', (platform) => {
      expect(platformAcceptsMedia(platform, 'short')).toBe(true)
    })
  })
})
