import { describe, it, expect, beforeEach } from 'vitest';
import { EdlAccumulator } from '../../tools/edl/accumulator.js';
import { text_overlay, highlight_region, slow_motion } from '../../tools/edl/effectTools.js';

describe('effectTools', () => {
  let acc: EdlAccumulator;

  beforeEach(() => {
    acc = new EdlAccumulator();
  });

  describe('text_overlay', () => {
    it('adds a text overlay decision to the accumulator', () => {
      text_overlay(acc, 5, 10, 'Hello World');

      const decisions = acc.getDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        type: 'effect',
        tool: 'text_overlay',
        startTime: 5,
        endTime: 10,
        params: {
          text: 'Hello World',
          position: 'bottom-center',
        },
      });
    });

    it('maps top position to top-center', () => {
      text_overlay(acc, 0, 5, 'Top text', 'top');

      const decisions = acc.getDecisions();
      expect(decisions[0].params).toMatchObject({
        text: 'Top text',
        position: 'top-center',
      });
    });

    it('maps center position to center', () => {
      text_overlay(acc, 0, 5, 'Center text', 'center');

      const decisions = acc.getDecisions();
      expect(decisions[0].params).toMatchObject({
        position: 'center',
      });
    });

    it('defaults to bottom position', () => {
      text_overlay(acc, 0, 5, 'Default position');

      const decisions = acc.getDecisions();
      expect(decisions[0].params).toMatchObject({
        position: 'bottom-center',
      });
    });

    it('returns a confirmation message', () => {
      const msg = text_overlay(acc, 2, 8, 'My Title', 'top');
      expect(msg).toBe('Added text overlay "My Title" from 2s to 8s at top');
    });
  });

  describe('highlight_region', () => {
    it('adds a highlight decision with coordinates', () => {
      highlight_region(acc, 1, 5, 100, 200, 300, 150);

      const decisions = acc.getDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        type: 'effect',
        tool: 'highlight_region',
        startTime: 1,
        endTime: 5,
        params: {
          x: 100,
          y: 200,
          width: 300,
          height: 150,
          color: 'yellow',
        },
      });
    });

    it('uses custom color', () => {
      highlight_region(acc, 0, 3, 10, 20, 50, 50, 'red');

      const decisions = acc.getDecisions();
      expect(decisions[0].params).toMatchObject({ color: 'red' });
    });

    it('defaults to yellow color', () => {
      highlight_region(acc, 0, 3, 10, 20, 50, 50);

      const decisions = acc.getDecisions();
      expect(decisions[0].params).toMatchObject({ color: 'yellow' });
    });

    it('returns a confirmation message', () => {
      const msg = highlight_region(acc, 1, 5, 100, 200, 300, 150, 'blue');
      expect(msg).toBe('Added highlight box at (100, 200) 300x150 from 1s to 5s with color blue');
    });
  });

  describe('slow_motion', () => {
    it('adds a slow motion decision', () => {
      slow_motion(acc, 10, 15, 0.5);

      const decisions = acc.getDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        type: 'effect',
        tool: 'slow_motion',
        startTime: 10,
        endTime: 15,
        params: {
          speed: 0.5,
          preservePitch: true,
        },
      });
    });

    it('sets preservePitch true for speed >= 0.5', () => {
      slow_motion(acc, 0, 5, 0.5);
      expect(acc.getDecisions()[0].params).toMatchObject({ preservePitch: true });
    });

    it('sets preservePitch false for speed < 0.5', () => {
      slow_motion(acc, 0, 5, 0.25);
      expect(acc.getDecisions()[0].params).toMatchObject({ preservePitch: false });
    });

    it('handles fast-forward speeds', () => {
      slow_motion(acc, 0, 5, 2.0);
      expect(acc.getDecisions()[0].params).toMatchObject({ speed: 2.0, preservePitch: true });
    });

    it('returns slow motion message for speed < 1', () => {
      const msg = slow_motion(acc, 10, 15, 0.5);
      expect(msg).toBe('Added 0.5x slow motion from 10s to 15s');
    });

    it('returns speed message for speed >= 1', () => {
      const msg = slow_motion(acc, 10, 15, 2);
      expect(msg).toBe('Added 2x speed from 10s to 15s');
    });
  });
});
