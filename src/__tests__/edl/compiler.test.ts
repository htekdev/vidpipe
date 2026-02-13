import { describe, it, expect } from 'vitest'
import { compileEdl } from '../../tools/edl/compiler.js'
import type { EditDecisionList } from '../../types/edl.js'

/**
 * Helper to build a minimal EDL with the given decisions.
 */
function makeEdl(
  decisions: EditDecisionList['decisions'],
  metadata?: EditDecisionList['metadata'],
): EditDecisionList {
  return {
    decisions,
    sourceVideo: '/test/video.mp4',
    outputPath: '/test/output.mp4',
    metadata: {
      sourceDuration: 120,
      outputWidth: 1920,
      outputHeight: 1080,
      ...metadata,
    },
  }
}

describe('EDL Compiler', () => {
  // ==========================================================================
  // Gap #1: Segment Trimming (gaps between layouts)
  // ==========================================================================
  describe('segment trimming via layout gaps', () => {
    it('should only include time ranges covered by layouts', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 2, params: {} },
        { id: 'l2', type: 'layout', tool: 'split_layout', startTime: 3, endTime: 5, params: {} },
      ])

      const result = compileEdl(edl)

      // Should trim two segments: 0-2 and 3-5, skipping 2-3
      expect(result.filterComplex).toContain('trim=start=0.000:end=2.000')
      expect(result.filterComplex).toContain('trim=start=3.000:end=5.000')
      // Should NOT contain trim for the gap region
      expect(result.filterComplex).not.toContain('trim=start=2.000')
    })

    it('should produce concat for gap-separated segments', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 5, params: {} },
        { id: 'l2', type: 'layout', tool: 'split_layout', startTime: 10, endTime: 15, params: {} },
      ])

      const result = compileEdl(edl)

      // The two segments should be concatenated
      expect(result.filterComplex).toContain('concat=n=2')
    })
  })

  // ==========================================================================
  // Gap #2: Fade to Black
  // ==========================================================================
  describe('fade_to_black effect', () => {
    it('should produce video fade filter', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        { id: 'e1', type: 'effect', tool: 'fade_to_black', startTime: 8, endTime: 10, params: { duration: 2 } },
      ])

      const result = compileEdl(edl)

      expect(result.filterComplex).toContain('fade=type=out:start_time=8.000:duration=2.000:color=black')
    })

    it('should produce audio fade filter', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        { id: 'e1', type: 'effect', tool: 'fade_to_black', startTime: 9, params: { duration: 1 } },
      ])

      const result = compileEdl(edl)

      expect(result.filterComplex).toContain('afade=type=out:start_time=9.000:duration=1.000')
    })

    it('should default to 1 second duration', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        { id: 'e1', type: 'effect', tool: 'fade_to_black', startTime: 9, params: {} },
      ])

      const result = compileEdl(edl)

      expect(result.filterComplex).toContain('fade=type=out:start_time=9.000:duration=1.000')
    })

    it('should map audio output to afaded label', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        { id: 'e1', type: 'effect', tool: 'fade_to_black', startTime: 9, params: {} },
      ])

      const result = compileEdl(edl)

      expect(result.outputArgs).toContain('[afaded]')
    })
  })

  // ==========================================================================
  // Gap #3: Text Overlay Animations
  // ==========================================================================
  describe('text_overlay animations', () => {
    it('should produce basic drawtext without animation', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'text_overlay',
          startTime: 2, endTime: 5,
          params: { text: 'Hello', position: 'center' },
        },
      ])

      const result = compileEdl(edl)

      expect(result.filterComplex).toContain("drawtext=text='Hello'")
      expect(result.filterComplex).toContain('between(t,2.000,5.000)')
    })

    it('should produce alpha expression for fade-in animation', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'text_overlay',
          startTime: 2, endTime: 5,
          params: { text: 'Fade', position: 'center', animation: 'fade-in' },
        },
      ])

      const result = compileEdl(edl)

      expect(result.filterComplex).toContain('alpha=')
      expect(result.filterComplex).toContain('min(1,')
    })

    it('should produce animated y position for slide-up', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'text_overlay',
          startTime: 2, endTime: 5,
          params: { text: 'Slide', position: 'bottom-center', animation: 'slide-up' },
        },
      ])

      const result = compileEdl(edl)

      // Should have an if() expression in the y coordinate
      expect(result.filterComplex).toMatch(/y=if\(/)
    })

    it('should produce animated fontsize for pop', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'text_overlay',
          startTime: 2, endTime: 5,
          params: { text: 'Pop', position: 'center', fontSize: 48, animation: 'pop' },
        },
      ])

      const result = compileEdl(edl)

      // Pop should have an if() expression in fontsize with 140% scale (67 for 48*1.4)
      expect(result.filterComplex).toMatch(/fontsize=if\(/)
      expect(result.filterComplex).toContain('67') // Math.round(48 * 1.4)
    })

    it('should use fontPath when metadata provides it', () => {
      const edl = makeEdl(
        [
          { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
          {
            id: 'e1', type: 'effect', tool: 'text_overlay',
            startTime: 2, endTime: 5,
            params: { text: 'Font', position: 'center' },
          },
        ],
        { fontPath: '/fonts/Montserrat-Bold.ttf' },
      )

      const result = compileEdl(edl)

      expect(result.filterComplex).toContain('fontfile=/fonts/Montserrat-Bold.ttf')
    })
  })

  // ==========================================================================
  // Gap #4: Highlight Region — normalized coords, animations, dimOutside
  // ==========================================================================
  describe('highlight_region enhancements', () => {
    it('should use pixel coordinates when values > 1', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'highlight_region',
          startTime: 2, endTime: 5,
          params: { x: 100, y: 200, width: 300, height: 150 },
        },
      ])

      const result = compileEdl(edl)

      expect(result.filterComplex).toContain('drawbox=x=100:y=200:w=300:h=150')
    })

    it('should convert normalized coordinates (0-1) to pixel expressions', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'highlight_region',
          startTime: 2, endTime: 5,
          params: { x: 0.1, y: 0.2, width: 0.5, height: 0.3 },
        },
      ])

      const result = compileEdl(edl)

      expect(result.filterComplex).toContain('iw*0.100')
      expect(result.filterComplex).toContain('ih*0.200')
      expect(result.filterComplex).toContain('iw*0.500')
      expect(result.filterComplex).toContain('ih*0.300')
    })

    it('should produce pulse animation with oscillating thickness', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'highlight_region',
          startTime: 2, endTime: 5,
          params: { x: 0.1, y: 0.1, width: 0.5, height: 0.3, animation: 'pulse' },
        },
      ])

      const result = compileEdl(edl)

      expect(result.filterComplex).toContain('abs(sin(t*6.28))')
    })

    it('should produce draw animation with progressive width', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'highlight_region',
          startTime: 2, endTime: 5,
          params: { x: 100, y: 100, width: 300, height: 200, animation: 'draw' },
        },
      ])

      const result = compileEdl(edl)

      // Progressive width should contain min() with time-based expression
      expect(result.filterComplex).toContain('min(')
    })

    it('should add dimOutside with full-frame semi-transparent overlay', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'highlight_region',
          startTime: 2, endTime: 5,
          params: { x: 100, y: 100, width: 300, height: 200, dimOutside: true },
        },
      ])

      const result = compileEdl(edl)

      // Should have a full-frame dark overlay before the highlight box
      expect(result.filterComplex).toContain('drawbox=x=0:y=0:w=iw:h=ih:color=black@0.5:t=fill')
    })
  })

  // ==========================================================================
  // Gap #5: B-Roll Support
  // ==========================================================================
  describe('b_roll effect', () => {
    it('should add inputArgs for b_roll images', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'b_roll',
          startTime: 3, endTime: 6,
          params: { imagePath: '/images/overlay.png', displayMode: 'fullscreen' },
        },
      ])

      const result = compileEdl(edl)

      expect(result.inputArgs).toContain('-i')
      expect(result.inputArgs).toContain('/images/overlay.png')
    })

    it('should produce fullscreen overlay filter for b_roll', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'b_roll',
          startTime: 3, endTime: 6,
          params: { imagePath: '/images/overlay.png', displayMode: 'fullscreen' },
        },
      ])

      const result = compileEdl(edl)

      expect(result.filterComplex).toContain('overlay=0:0')
      expect(result.filterComplex).toContain('between(t,3.000,6.000)')
    })

    it('should produce PiP overlay filter for b_roll', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'b_roll',
          startTime: 3, endTime: 6,
          params: {
            imagePath: '/images/logo.png',
            displayMode: 'picture-in-picture',
            pipPosition: 'top-right',
            pipSize: 20,
          },
        },
      ])

      const result = compileEdl(edl)

      expect(result.filterComplex).toContain('overlay=x=W-w-10:y=10')
      expect(result.filterComplex).toContain('scale=iw*20/100')
    })

    it('should skip b_roll without imagePath', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'b_roll',
          startTime: 3, endTime: 6,
          params: { imagePrompt: 'A robot icon' },
        },
      ])

      const result = compileEdl(edl)

      expect(result.inputArgs).toHaveLength(0)
      expect(result.filterComplex).not.toContain('overlay')
    })

    it('should return empty inputArgs when no b_roll effects', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
      ])

      const result = compileEdl(edl)

      expect(result.inputArgs).toEqual([])
    })
  })
})
