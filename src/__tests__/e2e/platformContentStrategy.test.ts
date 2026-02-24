import { describe, test, expect } from 'vitest'
import { Platform } from '../../L0-pure/types/index.js'
import {
  getMediaRule,
  platformAcceptsMedia,
} from '../../L3-services/socialPosting/platformContentStrategy.js'

describe('platformContentStrategy e2e', () => {
  test('LinkedIn accepts shorts and medium-clips but not full video', () => {
    expect(platformAcceptsMedia(Platform.LinkedIn, 'short')).toBe(true)
    expect(platformAcceptsMedia(Platform.LinkedIn, 'medium-clip')).toBe(true)
    expect(platformAcceptsMedia(Platform.LinkedIn, 'video')).toBe(false)
  })

  test('LinkedIn short uses captioned original (no portrait variant)', () => {
    const rule = getMediaRule(Platform.LinkedIn, 'short')
    expect(rule).not.toBeNull()
    expect(rule!.captions).toBe(true)
    expect(rule!.variantKey).toBeNull()
  })
})
