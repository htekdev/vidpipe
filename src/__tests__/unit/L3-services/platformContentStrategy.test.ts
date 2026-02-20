import { describe, it, expect } from 'vitest';
import { getMediaRule, platformAcceptsMedia } from '../../../L3-services/socialPosting/platformContentStrategy.js';
import { Platform } from '../../../L0-pure/types/index.js';

describe('platformContentStrategy', () => {
  describe('getMediaRule', () => {
    it('returns media rule for YouTube + video', () => {
      const rule = getMediaRule(Platform.YouTube, 'video');
      expect(rule).not.toBeNull();
      expect(rule!.captions).toBe(true);
    });

    it('returns media rule for YouTube + short', () => {
      const rule = getMediaRule(Platform.YouTube, 'short');
      expect(rule).not.toBeNull();
      expect(rule!.variantKey).toBe('youtube-shorts');
    });

    it('returns media rule for TikTok + short', () => {
      const rule = getMediaRule(Platform.TikTok, 'short');
      expect(rule).not.toBeNull();
      expect(rule!.variantKey).toBe('tiktok');
    });

    it('returns media rule for LinkedIn + short', () => {
      const rule = getMediaRule(Platform.LinkedIn, 'short');
      expect(rule).not.toBeNull();
      expect(rule!.captions).toBe(true);
      expect(rule!.variantKey).toBeNull();
    });

    it('returns null for TikTok + video (not in matrix)', () => {
      const rule = getMediaRule(Platform.TikTok, 'video');
      expect(rule).toBeNull();
    });

    it('returns media rule for LinkedIn + medium-clip', () => {
      const rule = getMediaRule(Platform.LinkedIn, 'medium-clip');
      expect(rule).not.toBeNull();
      expect(rule!.captions).toBe(true);
    });

    it('returns media rule for Instagram + short', () => {
      const rule = getMediaRule(Platform.Instagram, 'short');
      expect(rule).not.toBeNull();
      expect(rule!.variantKey).toBe('instagram-reels');
    });

    it('returns media rule for X + short', () => {
      const rule = getMediaRule(Platform.X, 'short');
      expect(rule).not.toBeNull();
      expect(rule!.variantKey).toBeNull();
    });

    it('returns null for LinkedIn + video (text-only)', () => {
      const rule = getMediaRule(Platform.LinkedIn, 'video');
      expect(rule).toBeNull();
    });
  });

  describe('platformAcceptsMedia', () => {
    it('returns true for YouTube + video', () => {
      expect(platformAcceptsMedia(Platform.YouTube, 'video')).toBe(true);
    });

    it('returns true for LinkedIn + short', () => {
      expect(platformAcceptsMedia(Platform.LinkedIn, 'short')).toBe(true);
    });

    it('returns true for TikTok + short', () => {
      expect(platformAcceptsMedia(Platform.TikTok, 'short')).toBe(true);
    });

    it('returns false for X + video', () => {
      expect(platformAcceptsMedia(Platform.X, 'video')).toBe(false);
    });

    it('returns true for Instagram + medium-clip', () => {
      expect(platformAcceptsMedia(Platform.Instagram, 'medium-clip')).toBe(true);
    });

    it('returns false for LinkedIn + video (text-only)', () => {
      expect(platformAcceptsMedia(Platform.LinkedIn, 'video')).toBe(false);
    });
  });
});
