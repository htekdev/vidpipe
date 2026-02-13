import { describe, it, expect } from 'vitest';
import {
  isLayoutDecision,
  isTransitionDecision,
  isEffectDecision,
  DEFAULT_LAYOUT_PARAMS,
  DEFAULT_TRANSITION_PARAMS,
  DEFAULT_EFFECT_PARAMS,
} from '../../types/edl.js';
import type { EditDecision } from '../../types/edl.js';

describe('edl type guards', () => {
  const layoutDecision: EditDecision = {
    id: 'layout-1',
    type: 'layout',
    tool: 'split_layout',
    startTime: 0,
    endTime: 10,
    params: {},
  };

  const transitionDecision: EditDecision = {
    id: 'transition-1',
    type: 'transition',
    tool: 'fade',
    startTime: 10,
    params: { duration: 0.5 },
  };

  const effectDecision: EditDecision = {
    id: 'effect-1',
    type: 'effect',
    tool: 'text_overlay',
    startTime: 5,
    endTime: 8,
    params: { text: 'Hello' },
  };

  describe('isLayoutDecision', () => {
    it('returns true for layout decisions', () => {
      expect(isLayoutDecision(layoutDecision)).toBe(true);
    });

    it('returns false for transition decisions', () => {
      expect(isLayoutDecision(transitionDecision)).toBe(false);
    });

    it('returns false for effect decisions', () => {
      expect(isLayoutDecision(effectDecision)).toBe(false);
    });
  });

  describe('isTransitionDecision', () => {
    it('returns true for transition decisions', () => {
      expect(isTransitionDecision(transitionDecision)).toBe(true);
    });

    it('returns false for layout decisions', () => {
      expect(isTransitionDecision(layoutDecision)).toBe(false);
    });

    it('returns false for effect decisions', () => {
      expect(isTransitionDecision(effectDecision)).toBe(false);
    });
  });

  describe('isEffectDecision', () => {
    it('returns true for effect decisions', () => {
      expect(isEffectDecision(effectDecision)).toBe(true);
    });

    it('returns false for layout decisions', () => {
      expect(isEffectDecision(layoutDecision)).toBe(false);
    });

    it('returns false for transition decisions', () => {
      expect(isEffectDecision(transitionDecision)).toBe(false);
    });
  });

  describe('DEFAULT_LAYOUT_PARAMS', () => {
    it('has params for all layout types', () => {
      expect(DEFAULT_LAYOUT_PARAMS).toHaveProperty('only_webcam');
      expect(DEFAULT_LAYOUT_PARAMS).toHaveProperty('only_screen');
      expect(DEFAULT_LAYOUT_PARAMS).toHaveProperty('split_layout');
      expect(DEFAULT_LAYOUT_PARAMS).toHaveProperty('zoom_webcam');
      expect(DEFAULT_LAYOUT_PARAMS).toHaveProperty('zoom_screen');
    });
  });

  describe('DEFAULT_TRANSITION_PARAMS', () => {
    it('has params for all transition types', () => {
      expect(DEFAULT_TRANSITION_PARAMS).toHaveProperty('fade');
      expect(DEFAULT_TRANSITION_PARAMS).toHaveProperty('swipe');
      expect(DEFAULT_TRANSITION_PARAMS).toHaveProperty('zoom_transition');
      expect(DEFAULT_TRANSITION_PARAMS).toHaveProperty('cut');
    });
  });

  describe('DEFAULT_EFFECT_PARAMS', () => {
    it('has params for all effect types', () => {
      expect(DEFAULT_EFFECT_PARAMS).toHaveProperty('text_overlay');
      expect(DEFAULT_EFFECT_PARAMS).toHaveProperty('highlight_region');
      expect(DEFAULT_EFFECT_PARAMS).toHaveProperty('slow_motion');
      expect(DEFAULT_EFFECT_PARAMS).toHaveProperty('b_roll');
    });
  });
});
