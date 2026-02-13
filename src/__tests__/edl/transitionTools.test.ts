import { describe, it, expect, beforeEach } from 'vitest';
import { EdlAccumulator } from '../../tools/edl/accumulator.js';
import { fade, swipe, zoom_transition, cut } from '../../tools/edl/transitionTools.js';

describe('transitionTools', () => {
  let acc: EdlAccumulator;

  beforeEach(() => {
    acc = new EdlAccumulator();
  });

  describe('fade', () => {
    it('adds a fade transition decision', () => {
      fade(acc, 10);

      const decisions = acc.getDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        type: 'transition',
        tool: 'fade',
        startTime: 10,
        params: { duration: 0.5 },
      });
    });

    it('uses custom duration', () => {
      fade(acc, 5, 1.0);

      const decisions = acc.getDecisions();
      expect(decisions[0].params).toMatchObject({ duration: 1.0 });
    });

    it('defaults to 0.5s duration', () => {
      fade(acc, 5);
      expect(acc.getDecisions()[0].params).toMatchObject({ duration: 0.5 });
    });

    it('returns a confirmation message', () => {
      const msg = fade(acc, 10, 0.8);
      expect(msg).toBe('Added fade transition at 10s (0.8s duration)');
    });
  });

  describe('swipe', () => {
    it('adds a swipe transition with direction', () => {
      swipe(acc, 15, 'left');

      const decisions = acc.getDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        type: 'transition',
        tool: 'swipe',
        startTime: 15,
        params: { direction: 'left' },
      });
    });

    it('supports all four directions', () => {
      swipe(acc, 0, 'right');
      swipe(acc, 5, 'up');
      swipe(acc, 10, 'down');

      const decisions = acc.getDecisions();
      expect(decisions[0].params).toMatchObject({ direction: 'right' });
      expect(decisions[1].params).toMatchObject({ direction: 'up' });
      expect(decisions[2].params).toMatchObject({ direction: 'down' });
    });

    it('returns a confirmation message', () => {
      const msg = swipe(acc, 15, 'right');
      expect(msg).toBe('Added swipe transition at 15s (direction: right)');
    });
  });

  describe('zoom_transition', () => {
    it('adds a zoom transition decision', () => {
      zoom_transition(acc, 20);

      const decisions = acc.getDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        type: 'transition',
        tool: 'zoom_transition',
        startTime: 20,
        params: { duration: 0.5 },
      });
    });

    it('uses custom duration', () => {
      zoom_transition(acc, 10, 1.5);

      expect(acc.getDecisions()[0].params).toMatchObject({ duration: 1.5 });
    });

    it('returns a confirmation message', () => {
      const msg = zoom_transition(acc, 20, 0.3);
      expect(msg).toBe('Added zoom transition at 20s (0.3s duration)');
    });
  });

  describe('cut', () => {
    it('adds a hard cut decision', () => {
      cut(acc, 30);

      const decisions = acc.getDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        type: 'transition',
        tool: 'cut',
        startTime: 30,
        params: {},
      });
    });

    it('returns a confirmation message', () => {
      const msg = cut(acc, 30);
      expect(msg).toBe('Added hard cut at 30s');
    });
  });
});
