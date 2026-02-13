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

      expect(result.filterComplex).toContain("drawtext=text=Hello")
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

    it('should escape commas in slide-up y expression for FFmpeg', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'text_overlay',
          startTime: 2, endTime: 5,
          params: { text: 'Slide', position: 'bottom-center', animation: 'slide-up' },
        },
      ])

      const result = compileEdl(edl)

      // Commas in if(lt(t,...),y+offset,...,y) must be escaped as \, for FFmpeg
      // Unescaped commas are interpreted as filter chain separators, breaking the filter
      expect(result.filterComplex).toMatch(/y=if\(lt\(t\\,/)
      // Should not contain bare comma after lt() in the y expression
      expect(result.filterComplex).not.toMatch(/y=if\(lt\(t,/)
    })

    it('should produce static enlarged fontsize for pop (no expression — FFmpeg 8.x segfaults)', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'text_overlay',
          startTime: 2, endTime: 5,
          params: { text: 'Pop', position: 'center', fontSize: 48, animation: 'pop' },
        },
      ])

      const result = compileEdl(edl)

      // Pop uses static enlarged size (Math.round(48 * 1.15) = 55) — no if() expression
      expect(result.filterComplex).toContain('fontsize=55')
      expect(result.filterComplex).not.toMatch(/fontsize=if\(/)
    })

    it('should NOT use fontsize expression for pop animation (regression: FFmpeg 8.x segfault)', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'text_overlay',
          startTime: 2, endTime: 5,
          params: { text: 'Pop', position: 'center', fontSize: 48, animation: 'pop' },
        },
      ])

      const result = compileEdl(edl)

      // fontsize must never use if()/lt() — causes access violation (0xC0000005) in FFmpeg 8.x drawtext
      expect(result.filterComplex).not.toMatch(/fontsize=if\(/)
      expect(result.filterComplex).toMatch(/fontsize=\d+/)
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

    it('should single-quote fontfile path to prevent Windows drive colon from breaking filter parsing', () => {
      const edl = makeEdl(
        [
          { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
          {
            id: 'e1', type: 'effect', tool: 'text_overlay',
            startTime: 2, endTime: 5,
            params: { text: 'Hello', position: 'center' },
          },
        ],
        { fontPath: 'C:\\Repos\\project\\dist\\fonts\\Montserrat-Bold.ttf' },
      )

      const result = compileEdl(edl)

      // Path must have \\: double-escaping (2 actual \) for two-level FFmpeg parsing
      expect(result.filterComplex).toContain('fontfile=C\\\\:/Repos/project/dist/fonts/Montserrat-Bold.ttf')
      // Must NOT have bare C: without escaping
      expect(result.filterComplex).not.toMatch(/fontfile=C:[^\\]/)
    })

    it('should escape single quotes and colons in text for FFmpeg filter option parser', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'text_overlay',
          startTime: 2, endTime: 5,
          params: { text: "Let's go: party", position: 'center' },
        },
      ])

      const result = compileEdl(edl)

      // \\' double-escapes single quote (3 actual \), \\: double-escapes colon (2 actual \)
      expect(result.filterComplex).toContain("text=Let\\\\\\'s go\\\\: party")
    })
  })

  // ==========================================================================
  // Gap #4: Highlight Region— normalized coords, animations, dimOutside
  // ==========================================================================
  describe('highlight_region enhancements', () => {
    it('should normalize pixel coordinates (>1) to iw/ih expressions', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'highlight_region',
          startTime: 2, endTime: 5,
          params: { x: 100, y: 200, width: 300, height: 150 },
        },
      ])

      const result = compileEdl(edl)

      // Pixel coords are normalized (÷1920 and ÷1080) then output as iw*/ih* expressions
      expect(result.filterComplex).toContain('drawbox=x=iw*0.052:y=ih*0.185:w=iw*0.156:h=ih*0.139')
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

    it('should produce pulse animation with max thickness', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'highlight_region',
          startTime: 2, endTime: 5,
          params: { x: 0.1, y: 0.1, width: 0.5, height: 0.3, animation: 'pulse' },
        },
      ])

      const result = compileEdl(edl)

      // Pulse uses fixed max thickness (borderWidth * 3 = 9)
      expect(result.filterComplex).toContain('t=9')
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

    it('should escape commas in draw animation width expression for FFmpeg', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'highlight_region',
          startTime: 2, endTime: 5,
          params: { x: 100, y: 100, width: 300, height: 200, animation: 'draw' },
        },
      ])

      const result = compileEdl(edl)

      // The min() expression with normalized coords must have escaped commas
      expect(result.filterComplex).toMatch(/w=min\(iw\*[\d.]+\\,/)
      expect(result.filterComplex).not.toMatch(/w=min\(iw\*[\d.]+,/)
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
  // Gap #4b: Zoom + highlight_region coordinate transformation
  // ==========================================================================
  describe('zoom-aware highlight_region coordinates', () => {
    it('should transform drawbox coordinates when zoom_screen with region is active', () => {
      const edl = makeEdl([
        {
          id: 'l1', type: 'layout', tool: 'zoom_screen',
          startTime: 0, endTime: 10,
          params: { scale: 1.0, region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } },
        },
        {
          id: 'e1', type: 'effect', tool: 'highlight_region',
          startTime: 2, endTime: 5,
          // Source coords (0.5, 0.5) should map to (0.5, 0.5) in output
          // since zoom crops (0.25, 0.25, 0.5, 0.5)
          // out = (0.5 - 0.25) / 0.5 = 0.5
          params: { x: 0.5, y: 0.5, width: 0.2, height: 0.1 },
        },
      ])

      const result = compileEdl(edl)

      // Coords should be transformed: (0.5-0.25)/0.5 = 0.5, w: 0.2/0.5 = 0.4
      expect(result.filterComplex).toContain('iw*0.500')
      expect(result.filterComplex).toContain('ih*0.500')
      expect(result.filterComplex).toContain('iw*0.400') // width doubled
      expect(result.filterComplex).toContain('ih*0.200') // height doubled
    })

    it('should skip highlight_region when target is outside zoom crop', () => {
      const edl = makeEdl([
        {
          id: 'l1', type: 'layout', tool: 'zoom_screen',
          startTime: 0, endTime: 10,
          params: { scale: 1.0, region: { x: 0.5, y: 0.5, width: 0.4, height: 0.4 } },
        },
        {
          id: 'e1', type: 'effect', tool: 'highlight_region',
          startTime: 2, endTime: 5,
          // Source coords (0.1, 0.1) are outside the zoom region (0.5-0.9)
          params: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
        },
      ])

      const result = compileEdl(edl)

      // Effect should be skipped (no drawbox in output)
      expect(result.filterComplex).not.toContain('drawbox')
    })

    it('should NOT transform coordinates for non-zoom layouts', () => {
      const edl = makeEdl([
        { id: 'l1', type: 'layout', tool: 'split_layout', startTime: 0, endTime: 10, params: {} },
        {
          id: 'e1', type: 'effect', tool: 'highlight_region',
          startTime: 2, endTime: 5,
          params: { x: 0.3, y: 0.4, width: 0.2, height: 0.1 },
        },
      ])

      const result = compileEdl(edl)

      // Coords should pass through unchanged
      expect(result.filterComplex).toContain('iw*0.300')
      expect(result.filterComplex).toContain('ih*0.400')
    })

    it('should transform for zoom_screen center-zoom with scale', () => {
      const edl = makeEdl([
        {
          id: 'l1', type: 'layout', tool: 'zoom_screen',
          startTime: 0, endTime: 10,
          params: { scale: 2.0 }, // center zoom 2x → crops center 50%
        },
        {
          id: 'e1', type: 'effect', tool: 'highlight_region',
          startTime: 2, endTime: 5,
          // Center of frame (0.5, 0.5) should map to center (0.5, 0.5)
          // zoomFactor=0.5, offset=0.25
          // out = (0.5 - 0.25) / 0.5 = 0.5
          params: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
        },
      ])

      const result = compileEdl(edl)

      expect(result.filterComplex).toContain('iw*0.500')
      expect(result.filterComplex).toContain('ih*0.500')
      // width/height scaled: 0.1 / 0.5 = 0.2
      expect(result.filterComplex).toContain('iw*0.200')
      expect(result.filterComplex).toContain('ih*0.200')
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
