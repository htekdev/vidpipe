import { describe, it, expect, beforeEach } from 'vitest';
import { EdlAccumulator, createAccumulator, optimizeEdl } from '../../tools/edl/accumulator.js';
import type { EditDecisionList } from '../../types/edl.js';

describe('EdlAccumulator', () => {
  let accumulator: EdlAccumulator;

  beforeEach(() => {
    accumulator = createAccumulator();
  });

  describe('add()', () => {
    it('should add decisions with auto-generated IDs', () => {
      const id1 = accumulator.add({
        type: 'layout',
        tool: 'split_layout',
        startTime: 0,
        endTime: 30,
        params: {},
      });

      const id2 = accumulator.add({
        type: 'layout',
        tool: 'zoom_webcam',
        startTime: 30,
        endTime: 60,
        params: { scale: 1.5 },
      });

      expect(id1).toBe('layout-1');
      expect(id2).toBe('layout-2');
    });

    it('should generate IDs based on decision type', () => {
      const layoutId = accumulator.add({
        type: 'layout',
        tool: 'split_layout',
        startTime: 0,
        params: {},
      });

      const effectId = accumulator.add({
        type: 'effect',
        tool: 'text_overlay',
        startTime: 5,
        endTime: 10,
        params: { text: 'Hello', position: 'center' },
      });

      const transitionId = accumulator.add({
        type: 'transition',
        tool: 'fade',
        startTime: 30,
        params: { duration: 0.5 },
      });

      expect(layoutId).toBe('layout-1');
      expect(effectId).toBe('effect-2');
      expect(transitionId).toBe('transition-3');
    });
  });

  describe('getDecisions()', () => {
    it('should return decisions sorted by startTime', () => {
      accumulator.add({
        type: 'layout',
        tool: 'zoom_webcam',
        startTime: 30,
        endTime: 60,
        params: {},
      });

      accumulator.add({
        type: 'layout',
        tool: 'split_layout',
        startTime: 0,
        endTime: 30,
        params: {},
      });

      accumulator.add({
        type: 'effect',
        tool: 'text_overlay',
        startTime: 15,
        endTime: 25,
        params: {},
      });

      const decisions = accumulator.getDecisions();

      expect(decisions).toHaveLength(3);
      expect(decisions[0].startTime).toBe(0);
      expect(decisions[1].startTime).toBe(15);
      expect(decisions[2].startTime).toBe(30);
    });

    it('should return a copy, not the original array', () => {
      accumulator.add({
        type: 'layout',
        tool: 'split_layout',
        startTime: 0,
        params: {},
      });

      const decisions1 = accumulator.getDecisions();
      const decisions2 = accumulator.getDecisions();

      expect(decisions1).not.toBe(decisions2);
      expect(decisions1).toEqual(decisions2);
    });
  });

  describe('toEdl()', () => {
    it('should build a complete EDL', () => {
      accumulator.add({
        type: 'layout',
        tool: 'split_layout',
        startTime: 0,
        endTime: 30,
        params: { screenPercent: 65 },
      });

      const edl = accumulator.toEdl('/videos/source.mp4', '/videos/output.mp4');

      expect(edl.sourceVideo).toBe('/videos/source.mp4');
      expect(edl.outputPath).toBe('/videos/output.mp4');
      expect(edl.decisions).toHaveLength(1);
      expect(edl.webcamRegion).toBeUndefined();
    });

    it('should include webcam region when provided', () => {
      accumulator.add({
        type: 'layout',
        tool: 'only_webcam',
        startTime: 0,
        params: {},
      });

      const webcamRegion = { x: 100, y: 200, width: 320, height: 240 };
      const edl = accumulator.toEdl('/videos/source.mp4', '/videos/output.mp4', webcamRegion);

      expect(edl.webcamRegion).toEqual(webcamRegion);
    });
  });

  describe('clear()', () => {
    it('should remove all decisions', () => {
      accumulator.add({
        type: 'layout',
        tool: 'split_layout',
        startTime: 0,
        params: {},
      });

      accumulator.add({
        type: 'effect',
        tool: 'text_overlay',
        startTime: 5,
        params: {},
      });

      accumulator.clear();

      expect(accumulator.getDecisions()).toHaveLength(0);
    });

    it('should reset ID counter', () => {
      accumulator.add({
        type: 'layout',
        tool: 'split_layout',
        startTime: 0,
        params: {},
      });

      accumulator.clear();

      const newId = accumulator.add({
        type: 'layout',
        tool: 'zoom_webcam',
        startTime: 0,
        params: {},
      });

      expect(newId).toBe('layout-1');
    });
  });

  describe('validate()', () => {
    it('should pass validation for non-overlapping layouts', () => {
      accumulator.add({
        type: 'layout',
        tool: 'split_layout',
        startTime: 0,
        endTime: 30,
        params: {},
      });

      accumulator.add({
        type: 'layout',
        tool: 'zoom_webcam',
        startTime: 30,
        endTime: 60,
        params: {},
      });

      const result = accumulator.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation for overlapping layouts', () => {
      accumulator.add({
        type: 'layout',
        tool: 'split_layout',
        startTime: 0,
        endTime: 35,
        params: {},
      });

      accumulator.add({
        type: 'layout',
        tool: 'zoom_webcam',
        startTime: 30,
        endTime: 60,
        params: {},
      });

      const result = accumulator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Layout decisions overlap');
    });

    it('should allow effects to overlap with layouts', () => {
      accumulator.add({
        type: 'layout',
        tool: 'split_layout',
        startTime: 0,
        endTime: 60,
        params: {},
      });

      accumulator.add({
        type: 'effect',
        tool: 'text_overlay',
        startTime: 10,
        endTime: 20,
        params: { text: 'Hello', position: 'center' },
      });

      accumulator.add({
        type: 'effect',
        tool: 'highlight_region',
        startTime: 15,
        endTime: 25,
        params: { x: 0, y: 0, width: 100, height: 100 },
      });

      const result = accumulator.validate();

      expect(result.valid).toBe(true);
    });

    it('should validate transitions at layout boundaries', () => {
      accumulator.add({
        type: 'layout',
        tool: 'split_layout',
        startTime: 0,
        endTime: 30,
        params: {},
      });

      accumulator.add({
        type: 'transition',
        tool: 'fade',
        startTime: 30,
        params: { duration: 0.5 },
      });

      accumulator.add({
        type: 'layout',
        tool: 'zoom_webcam',
        startTime: 30,
        endTime: 60,
        params: {},
      });

      const result = accumulator.validate();

      expect(result.valid).toBe(true);
    });

    it('should fail validation for transitions not at layout boundaries', () => {
      accumulator.add({
        type: 'layout',
        tool: 'split_layout',
        startTime: 0,
        endTime: 30,
        params: {},
      });

      accumulator.add({
        type: 'transition',
        tool: 'fade',
        startTime: 15, // Not at a boundary
        params: { duration: 0.5 },
      });

      const result = accumulator.validate();

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('not at a layout boundary');
    });

    it('should pass validation for empty accumulator', () => {
      const result = accumulator.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle layouts without endTime', () => {
      accumulator.add({
        type: 'layout',
        tool: 'split_layout',
        startTime: 0,
        // No endTime - extends to infinity
        params: {},
      });

      accumulator.add({
        type: 'layout',
        tool: 'zoom_webcam',
        startTime: 30,
        params: {},
      });

      const result = accumulator.validate();

      // Should detect overlap since first layout has no end
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('overlap');
    });
  });
});

describe('createAccumulator()', () => {
  it('should create a new EdlAccumulator instance', () => {
    const acc = createAccumulator();

    expect(acc).toBeInstanceOf(EdlAccumulator);
    expect(acc.getDecisions()).toHaveLength(0);
  });
});

describe('optimizeEdl()', () => {
  it('should merge adjacent layouts with same tool and params', () => {
    const edl: EditDecisionList = {
      sourceVideo: '/source.mp4',
      outputPath: '/output.mp4',
      decisions: [
        { id: 'layout-1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 30, params: {} },
        { id: 'layout-2', type: 'layout', tool: 'split_layout', startTime: 30, endTime: 60, params: {} },
        { id: 'layout-3', type: 'layout', tool: 'split_layout', startTime: 60, endTime: 90, params: {} },
      ],
    };

    const optimized = optimizeEdl(edl);

    expect(optimized.decisions).toHaveLength(1);
    expect(optimized.decisions[0].startTime).toBe(0);
    expect(optimized.decisions[0].endTime).toBe(90);
  });

  it('should not merge layouts with different tools', () => {
    const edl: EditDecisionList = {
      sourceVideo: '/source.mp4',
      outputPath: '/output.mp4',
      decisions: [
        { id: 'layout-1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 30, params: {} },
        { id: 'layout-2', type: 'layout', tool: 'zoom_webcam', startTime: 30, endTime: 60, params: {} },
      ],
    };

    const optimized = optimizeEdl(edl);

    expect(optimized.decisions.filter((d) => d.type === 'layout')).toHaveLength(2);
  });

  it('should not merge layouts with different params', () => {
    const edl: EditDecisionList = {
      sourceVideo: '/source.mp4',
      outputPath: '/output.mp4',
      decisions: [
        {
          id: 'layout-1',
          type: 'layout',
          tool: 'split_layout',
          startTime: 0,
          endTime: 30,
          params: { screenPercent: 65 },
        },
        {
          id: 'layout-2',
          type: 'layout',
          tool: 'split_layout',
          startTime: 30,
          endTime: 60,
          params: { screenPercent: 50 },
        },
      ],
    };

    const optimized = optimizeEdl(edl);

    expect(optimized.decisions.filter((d) => d.type === 'layout')).toHaveLength(2);
  });

  it('should remove transitions between identical layouts', () => {
    const edl: EditDecisionList = {
      sourceVideo: '/source.mp4',
      outputPath: '/output.mp4',
      decisions: [
        { id: 'layout-1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 30, params: {} },
        { id: 'transition-1', type: 'transition', tool: 'fade', startTime: 30, params: { duration: 0.5 } },
        { id: 'layout-2', type: 'layout', tool: 'split_layout', startTime: 30, endTime: 60, params: {} },
      ],
    };

    const optimized = optimizeEdl(edl);

    // Layouts should merge, transition should be removed
    const layouts = optimized.decisions.filter((d) => d.type === 'layout');
    const transitions = optimized.decisions.filter((d) => d.type === 'transition');

    expect(layouts).toHaveLength(1);
    expect(transitions).toHaveLength(0);
  });

  it('should keep transitions between different layouts', () => {
    const edl: EditDecisionList = {
      sourceVideo: '/source.mp4',
      outputPath: '/output.mp4',
      decisions: [
        { id: 'layout-1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 30, params: {} },
        { id: 'transition-1', type: 'transition', tool: 'fade', startTime: 30, params: { duration: 0.5 } },
        { id: 'layout-2', type: 'layout', tool: 'zoom_webcam', startTime: 30, endTime: 60, params: {} },
      ],
    };

    const optimized = optimizeEdl(edl);

    const transitions = optimized.decisions.filter((d) => d.type === 'transition');
    expect(transitions).toHaveLength(1);
  });

  it('should merge overlapping effects of same type with same params', () => {
    const edl: EditDecisionList = {
      sourceVideo: '/source.mp4',
      outputPath: '/output.mp4',
      decisions: [
        {
          id: 'effect-1',
          type: 'effect',
          tool: 'text_overlay',
          startTime: 0,
          endTime: 20,
          params: { text: 'Hello', position: 'center' },
        },
        {
          id: 'effect-2',
          type: 'effect',
          tool: 'text_overlay',
          startTime: 15,
          endTime: 30,
          params: { text: 'Hello', position: 'center' },
        },
      ],
    };

    const optimized = optimizeEdl(edl);

    const effects = optimized.decisions.filter((d) => d.type === 'effect');
    expect(effects).toHaveLength(1);
    expect(effects[0].startTime).toBe(0);
    expect(effects[0].endTime).toBe(30);
  });

  it('should not merge effects with different params', () => {
    const edl: EditDecisionList = {
      sourceVideo: '/source.mp4',
      outputPath: '/output.mp4',
      decisions: [
        {
          id: 'effect-1',
          type: 'effect',
          tool: 'text_overlay',
          startTime: 0,
          endTime: 20,
          params: { text: 'Hello', position: 'center' },
        },
        {
          id: 'effect-2',
          type: 'effect',
          tool: 'text_overlay',
          startTime: 15,
          endTime: 30,
          params: { text: 'World', position: 'center' },
        },
      ],
    };

    const optimized = optimizeEdl(edl);

    const effects = optimized.decisions.filter((d) => d.type === 'effect');
    expect(effects).toHaveLength(2);
  });

  it('should preserve metadata in optimized EDL', () => {
    const edl: EditDecisionList = {
      sourceVideo: '/source.mp4',
      outputPath: '/output.mp4',
      webcamRegion: { x: 100, y: 200, width: 320, height: 240 },
      metadata: { description: 'Test edit' },
      decisions: [
        { id: 'layout-1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 30, params: {} },
      ],
    };

    const optimized = optimizeEdl(edl);

    expect(optimized.sourceVideo).toBe('/source.mp4');
    expect(optimized.outputPath).toBe('/output.mp4');
    expect(optimized.webcamRegion).toEqual({ x: 100, y: 200, width: 320, height: 240 });
    expect(optimized.metadata).toEqual({ description: 'Test edit' });
  });

  it('should handle empty EDL', () => {
    const edl: EditDecisionList = {
      sourceVideo: '/source.mp4',
      outputPath: '/output.mp4',
      decisions: [],
    };

    const optimized = optimizeEdl(edl);

    expect(optimized.decisions).toHaveLength(0);
  });

  it('should return decisions sorted by startTime', () => {
    const edl: EditDecisionList = {
      sourceVideo: '/source.mp4',
      outputPath: '/output.mp4',
      decisions: [
        { id: 'layout-2', type: 'layout', tool: 'zoom_webcam', startTime: 30, endTime: 60, params: {} },
        { id: 'effect-1', type: 'effect', tool: 'text_overlay', startTime: 10, endTime: 20, params: {} },
        { id: 'layout-1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 30, params: {} },
      ],
    };

    const optimized = optimizeEdl(edl);

    expect(optimized.decisions[0].startTime).toBe(0);
    expect(optimized.decisions[1].startTime).toBe(10);
    expect(optimized.decisions[2].startTime).toBe(30);
  });
});
