import { describe, it, expect, beforeEach } from 'vitest';
import { EdlAccumulator } from '../../tools/edl/accumulator.js';
import {
  only_webcam,
  only_screen,
  split_layout,
  zoom_webcam,
  zoom_screen,
} from '../../tools/edl/layoutTools.js';

describe('layoutTools', () => {
  let acc: EdlAccumulator;

  beforeEach(() => {
    acc = new EdlAccumulator();
  });

  describe('only_webcam', () => {
    it('adds an only_webcam layout decision', () => {
      only_webcam(acc, 0, 10);

      const decisions = acc.getDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        type: 'layout',
        tool: 'only_webcam',
        startTime: 0,
        endTime: 10,
        params: {},
      });
    });

    it('returns a confirmation message', () => {
      const msg = only_webcam(acc, 5, 15);
      expect(msg).toBe('Added only_webcam layout from 5s to 15s');
    });
  });

  describe('only_screen', () => {
    it('adds an only_screen layout decision', () => {
      only_screen(acc, 0, 30);

      const decisions = acc.getDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        type: 'layout',
        tool: 'only_screen',
        startTime: 0,
        endTime: 30,
        params: {},
      });
    });

    it('returns a confirmation message', () => {
      const msg = only_screen(acc, 10, 20);
      expect(msg).toBe('Added only_screen layout from 10s to 20s');
    });
  });

  describe('split_layout', () => {
    it('adds a split_layout decision with default params', () => {
      split_layout(acc, 0, 60);

      const decisions = acc.getDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        type: 'layout',
        tool: 'split_layout',
        startTime: 0,
        endTime: 60,
        params: {
          screenPercent: 65,
          webcamPosition: 'bottom-right',
        },
      });
    });

    it('returns a confirmation message with percentage', () => {
      const msg = split_layout(acc, 0, 60);
      expect(msg).toBe('Added split_layout from 0s to 60s (screen 65%, webcam 35%)');
    });
  });

  describe('zoom_webcam', () => {
    it('adds a zoom_webcam decision with default scale', () => {
      zoom_webcam(acc, 5, 15);

      const decisions = acc.getDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        type: 'layout',
        tool: 'zoom_webcam',
        startTime: 5,
        endTime: 15,
        params: { scale: 1.2 },
      });
    });

    it('uses custom scale', () => {
      zoom_webcam(acc, 0, 10, 2.0);

      const decisions = acc.getDecisions();
      expect(decisions[0].params).toMatchObject({ scale: 2.0 });
    });

    it('returns a confirmation message', () => {
      const msg = zoom_webcam(acc, 5, 15, 1.5);
      expect(msg).toBe('Added zoom_webcam layout from 5s to 15s (scale: 1.5x)');
    });
  });

  describe('zoom_screen', () => {
    it('adds a zoom_screen decision with default scale', () => {
      zoom_screen(acc, 10, 25);

      const decisions = acc.getDecisions();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        type: 'layout',
        tool: 'zoom_screen',
        startTime: 10,
        endTime: 25,
        params: { scale: 1.5 },
      });
    });

    it('includes region when provided', () => {
      const region = { x: 0.1, y: 0.2, width: 0.5, height: 0.3 };
      zoom_screen(acc, 0, 10, region);

      const decisions = acc.getDecisions();
      expect(decisions[0].params).toMatchObject({
        scale: 1.5,
        region,
      });
    });

    it('omits region when not provided', () => {
      zoom_screen(acc, 0, 10);

      const decisions = acc.getDecisions();
      expect(decisions[0].params).toMatchObject({ scale: 1.5, region: undefined });
    });

    it('returns a message without region', () => {
      const msg = zoom_screen(acc, 10, 25);
      expect(msg).toBe('Added zoom_screen layout from 10s to 25s');
    });

    it('returns a message with region description', () => {
      const region = { x: 0.1, y: 0.2, width: 0.5, height: 0.3 };
      const msg = zoom_screen(acc, 10, 25, region);
      expect(msg).toBe(
        'Added zoom_screen layout from 10s to 25s on region (0.1, 0.2, 0.5x0.3)',
      );
    });
  });
});
