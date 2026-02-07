import { describe, it, expect } from 'vitest'
import { buildFilterComplex, KeepSegment } from '../tools/ffmpeg/singlePassEdit.js'

describe('buildFilterComplex', () => {
  describe('basic filter generation', () => {
    it('produces correct trim+setpts+concat for 2 segments', () => {
      const segments: KeepSegment[] = [
        { start: 0, end: 5.5 },
        { start: 8.2, end: 12.0 },
      ]
      const result = buildFilterComplex(segments)
      const lines = result.split(';\n')

      // 2 segments × 2 (video + audio) + 1 concat = 5 filter parts
      expect(lines).toHaveLength(5)

      // Video trim for segment 0
      expect(lines[0]).toBe('[0:v]trim=start=0.000:end=5.500,setpts=PTS-STARTPTS[v0]')
      // Audio trim for segment 0
      expect(lines[1]).toBe('[0:a]atrim=start=0.000:end=5.500,asetpts=PTS-STARTPTS[a0]')
      // Video trim for segment 1
      expect(lines[2]).toBe('[0:v]trim=start=8.200:end=12.000,setpts=PTS-STARTPTS[v1]')
      // Audio trim for segment 1
      expect(lines[3]).toBe('[0:a]atrim=start=8.200:end=12.000,asetpts=PTS-STARTPTS[a1]')
      // Concat
      expect(lines[4]).toBe('[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]')
    })

    it('formats timestamps to 3 decimal places', () => {
      const segments: KeepSegment[] = [{ start: 1.1, end: 2.22 }]
      const result = buildFilterComplex(segments)

      expect(result).toContain('start=1.100')
      expect(result).toContain('end=2.220')
    })

    it('each segment has paired video and audio trim filters', () => {
      const segments: KeepSegment[] = [
        { start: 0, end: 3 },
        { start: 5, end: 10 },
        { start: 15, end: 20 },
      ]
      const result = buildFilterComplex(segments)
      const lines = result.split(';\n')

      for (let i = 0; i < segments.length; i++) {
        const videoLine = lines[i * 2]
        const audioLine = lines[i * 2 + 1]

        expect(videoLine).toContain(`[0:v]trim=start=${segments[i].start.toFixed(3)}:end=${segments[i].end.toFixed(3)}`)
        expect(videoLine).toContain(`setpts=PTS-STARTPTS[v${i}]`)
        expect(audioLine).toContain(`[0:a]atrim=start=${segments[i].start.toFixed(3)}:end=${segments[i].end.toFixed(3)}`)
        expect(audioLine).toContain(`asetpts=PTS-STARTPTS[a${i}]`)
      }
    })

    it('concat n= matches segment count', () => {
      const segments: KeepSegment[] = [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
        { start: 4, end: 5 },
        { start: 6, end: 7 },
      ]
      const result = buildFilterComplex(segments)

      expect(result).toContain('concat=n=4:v=1:a=1')
    })

    it('concat inputs list all segment pairs in order', () => {
      const segments: KeepSegment[] = [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
        { start: 4, end: 5 },
      ]
      const result = buildFilterComplex(segments)

      expect(result).toContain('[v0][a0][v1][a1][v2][a2]concat=n=3')
    })
  })

  describe('with captions', () => {
    it('appends ASS subtitle filter after concat', () => {
      const segments: KeepSegment[] = [
        { start: 0, end: 5 },
        { start: 8, end: 12 },
      ]
      const result = buildFilterComplex(segments, { assFilename: 'captions.ass' })
      const lines = result.split(';\n')

      // Last line should be the ASS filter
      expect(lines[lines.length - 1]).toContain('ass=captions.ass')
      expect(lines[lines.length - 1]).toContain('[outv]')
    })

    it('uses intermediate labels [cv][ca] for concat when captions enabled', () => {
      const segments: KeepSegment[] = [{ start: 0, end: 5 }]
      const result = buildFilterComplex(segments, { assFilename: 'subs.ass' })

      expect(result).toContain('concat=n=1:v=1:a=1[cv][ca]')
      expect(result).not.toContain('[outv][outa]')
    })

    it('sets fontsdir parameter correctly', () => {
      const segments: KeepSegment[] = [{ start: 0, end: 5 }]
      const result = buildFilterComplex(segments, {
        assFilename: 'captions.ass',
        fontsdir: '/tmp/fonts',
      })

      expect(result).toContain('fontsdir=/tmp/fonts')
    })

    it('defaults fontsdir to "." when not specified', () => {
      const segments: KeepSegment[] = [{ start: 0, end: 5 }]
      const result = buildFilterComplex(segments, { assFilename: 'captions.ass' })

      expect(result).toContain('fontsdir=.')
    })

    it('without captions uses [outv][outa] labels directly', () => {
      const segments: KeepSegment[] = [{ start: 0, end: 5 }]
      const result = buildFilterComplex(segments)

      expect(result).toContain('[outv][outa]')
      expect(result).not.toContain('[cv]')
      expect(result).not.toContain('[ca]')
      expect(result).not.toContain('ass=')
    })
  })

  describe('edge cases', () => {
    it('single segment produces valid filter', () => {
      const segments: KeepSegment[] = [{ start: 0, end: 60 }]
      const result = buildFilterComplex(segments)
      const lines = result.split(';\n')

      expect(lines).toHaveLength(3) // video trim, audio trim, concat
      expect(result).toContain('concat=n=1:v=1:a=1[outv][outa]')
      expect(result).toContain('[v0][a0]')
    })

    it('handles 10+ segments correctly', () => {
      const segments: KeepSegment[] = Array.from({ length: 12 }, (_, i) => ({
        start: i * 10,
        end: i * 10 + 8,
      }))
      const result = buildFilterComplex(segments)
      const lines = result.split(';\n')

      // 12 segments × 2 + 1 concat = 25 lines
      expect(lines).toHaveLength(25)
      expect(result).toContain('concat=n=12:v=1:a=1')
      // Check double-digit indices
      expect(result).toContain('[v10]')
      expect(result).toContain('[a11]')
    })

    it('handles very short segments without negative durations', () => {
      const segments: KeepSegment[] = [
        { start: 5.001, end: 5.002 },
      ]
      const result = buildFilterComplex(segments)

      expect(result).toContain('start=5.001:end=5.002')
      // No negative values in the output
      expect(result).not.toMatch(/-\d+\.\d+/)
    })

    it('handles segments starting at 0', () => {
      const segments: KeepSegment[] = [{ start: 0, end: 1 }]
      const result = buildFilterComplex(segments)

      expect(result).toContain('start=0.000:end=1.000')
    })

    it('handles high-precision floating point timestamps', () => {
      const segments: KeepSegment[] = [{ start: 1.23456789, end: 9.87654321 }]
      const result = buildFilterComplex(segments)

      // toFixed(3) rounds correctly
      expect(result).toContain('start=1.235')
      expect(result).toContain('end=9.877')
    })
  })

  describe('input validation', () => {
    it('throws on empty segments array', () => {
      expect(() => buildFilterComplex([])).toThrow('keepSegments must not be empty')
    })
  })
})
