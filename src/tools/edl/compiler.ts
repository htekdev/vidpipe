/**
 * EDL Compiler — transforms EditDecisionList into FFmpeg commands.
 *
 * Compiles layout, transition, and effect decisions into a single-pass
 * FFmpeg filter_complex chain. Optimizes for minimal re-encodes.
 */

import logger from '../../config/logger.js'
import type {
  EditDecisionList,
  EditDecision,
  LayoutDecision,
  TransitionDecision,
  EffectDecision,
  WebcamRegion,
  LayoutType,
  TransitionType,
  EffectType,
  TextPosition,
  SwipeDirection,
  OnlyWebcamParams,
  OnlyScreenParams,
  SplitLayoutParams,
  ZoomWebcamParams,
  ZoomScreenParams,
  FadeParams,
  SwipeParams,
  ZoomTransitionParams,
  TextOverlayParams,
  HighlightRegionParams,
  SlowMotionParams,
  BRollParams,
  FadeToBlackParams,
  isLayoutDecision,
  isTransitionDecision,
  isEffectDecision,
} from '../../types/edl.js'

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Result of compiling an EDL into FFmpeg commands.
 */
export interface CompileResult {
  /** The -filter_complex argument */
  filterComplex: string
  /** Additional FFmpeg output args */
  outputArgs: string[]
  /** Number of encoding passes needed (1 ideally) */
  passes: number
  /** Additional input args for b-roll files (e.g., ['-i', 'image.png']) */
  inputArgs: string[]
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface OutputDimensions {
  width: number
  height: number
}

interface FilterSegment {
  startTime: number
  endTime: number
  filters: string[]
  label: string
}

/**
 * Tracks the zoom transformation active at each segment in the concat timeline.
 * Used to transform highlight_region coordinates from source space to output space.
 */
interface ZoomSegment {
  /** Start time in the concatenated timeline */
  concatStart: number
  /** End time in the concatenated timeline */
  concatEnd: number
  /** The layout type for this segment */
  layout: LayoutType
  /** The layout parameters */
  params: Record<string, unknown>
  /** Webcam region used for this segment */
  webcamRegion?: WebcamRegion
  /** Source video width */
  sourceWidth?: number
}

// ============================================================================
// TEXT POSITION MAPPING
// ============================================================================

/**
 * Map TextPosition to FFmpeg drawtext x:y coordinates.
 * Uses FFmpeg expressions for dynamic positioning.
 */
function getTextPosition(position: TextPosition | string, fontSize: number): { x: string; y: string } {
  const padding = Math.round(fontSize * 0.5)
  // Normalize shorthand positions the LLM might send
  const normalized = normalizeTextPosition(position)
  switch (normalized) {
    case 'top-left':
      return { x: `${padding}`, y: `${padding}` }
    case 'top-center':
      return { x: '(w-text_w)/2', y: `${padding}` }
    case 'top-right':
      return { x: `w-text_w-${padding}`, y: `${padding}` }
    case 'center':
      return { x: '(w-text_w)/2', y: '(h-text_h)/2' }
    case 'bottom-left':
      return { x: `${padding}`, y: `h-text_h-${padding}` }
    case 'bottom-center':
      return { x: '(w-text_w)/2', y: `h-text_h-${padding}` }
    case 'bottom-right':
      return { x: `w-text_w-${padding}`, y: `h-text_h-${padding}` }
    default:
      logger.warn(`[EDL Compiler] Unknown text position '${position}', defaulting to bottom-center`)
      return { x: '(w-text_w)/2', y: `h-text_h-${padding}` }
  }
}

/**
 * Normalize shorthand position strings to valid TextPosition values.
 * Handles LLM-generated shorthands like "top", "bottom", "left", "right".
 */
function normalizeTextPosition(position: string): TextPosition | string {
  switch (position) {
    case 'top': return 'top-center'
    case 'bottom': return 'bottom-center'
    case 'left': return 'bottom-left'
    case 'right': return 'bottom-right'
    default: return position
  }
}

/**
 * Escape a file path for use inside FFmpeg -filter_complex.
 * Two parsing levels: filtergraph then filter-option.
 * Converts backslashes to forward slashes and double-escapes colons:
 * \\: → filtergraph outputs \: → option parser reads literal :
 */
function escapeFFmpegPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\\\:')
}

/**
 * Escape text for use in FFmpeg drawtext `text=` value within -filter_complex.
 * Two parsing levels: filtergraph (splits by , ; handles ' and \) then
 * filter-option (splits by : handles ' and \).
 * Text is used WITHOUT single quotes to avoid nested quoting issues.
 */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\\\\\')   // \ → \\\\ (double-escape both levels)
    .replace(/'/g, "\\\\\\'")     // ' → \\\' (double-escape both levels)
    .replace(/:/g, '\\\\:')       // : → \\: (double-escape both levels)
    .replace(/;/g, '\\;')         // ; → \; (filtergraph level only)
    .replace(/\[/g, '\\[')        // [ → \[ (filtergraph level only)
    .replace(/\]/g, '\\]')        // ] → \] (filtergraph level only)
}

/**
 * Map SwipeDirection to FFmpeg xfade transition name.
 */
function getSwipeTransition(direction: SwipeDirection): string {
  switch (direction) {
    case 'left':
      return 'slideleft'
    case 'right':
      return 'slideright'
    case 'up':
      return 'slideup'
    case 'down':
      return 'slidedown'
  }
}

// ============================================================================
// ZOOM COORDINATE TRANSFORMATION
// ============================================================================

/**
 * Compute the zoom crop rectangle (in normalized 0-1 coords of the source frame)
 * for a given layout. Returns undefined if the layout doesn't zoom.
 *
 * The crop rect describes what portion of the source frame is visible after zoom.
 * For zoom_screen: the visible region after screen-area crop + zoom.
 * For zoom_webcam: not transformed (webcam-space coords don't map to source frame).
 */
function getZoomCropRect(
  layout: LayoutType,
  params: Record<string, unknown>,
  webcamRegion: WebcamRegion | undefined,
  sourceWidth?: number,
): { x: number; y: number; w: number; h: number } | undefined {
  if (layout === 'zoom_screen') {
    const p = params as ZoomScreenParams
    const scale = p.scale ?? 1.5

    if (p.region && typeof p.region.x === 'number' && typeof p.region.y === 'number') {
      // Zoom to specific normalized region
      return { x: p.region.x, y: p.region.y, w: p.region.width, h: p.region.height }
    }

    if (webcamRegion) {
      // First exclude webcam, then zoom center of screen area
      const srcW = sourceWidth ?? 1920
      const midX = Math.round(srcW / 2)
      const isWebcamRight = webcamRegion.x > midX
      // Screen area in normalized coordinates
      const screenStartX = isWebcamRight ? 0 : webcamRegion.width / srcW
      const screenWidth = isWebcamRight ? webcamRegion.x / srcW : 1 - webcamRegion.width / srcW

      const zoomFactor = 1 / scale
      const offsetX = (1 - zoomFactor) / 2
      const offsetY = (1 - zoomFactor) / 2
      // Zoom is applied AFTER screen crop, so coords are relative to screen area
      return {
        x: screenStartX + screenWidth * offsetX,
        y: offsetY,
        w: screenWidth * zoomFactor,
        h: zoomFactor,
      }
    }

    // No webcam, zoom center of full frame
    const zoomFactor = 1 / scale
    const offset = (1 - zoomFactor) / 2
    return { x: offset, y: offset, w: zoomFactor, h: zoomFactor }
  }

  // Non-zoom layouts don't transform coordinates
  return undefined
}

/**
 * Transform highlight_region coordinates from source-frame space to output space
 * based on the active zoom layout.
 *
 * @param coords - Normalized source-frame coordinates (0-1)
 * @param zoomRect - The zoom crop rectangle in normalized source-frame coords
 * @returns Transformed normalized coordinates in output space, or undefined if region is outside crop
 */
function transformCoordsForZoom(
  coords: { x: number; y: number; w: number; h: number },
  zoomRect: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } | undefined {
  const outX = (coords.x - zoomRect.x) / zoomRect.w
  const outY = (coords.y - zoomRect.y) / zoomRect.h
  const outW = coords.w / zoomRect.w
  const outH = coords.h / zoomRect.h

  // Clamp to visible area (0-1 range)
  const clampedX = Math.max(0, Math.min(1, outX))
  const clampedY = Math.max(0, Math.min(1, outY))
  const clampedW = Math.min(outW, 1 - clampedX)
  const clampedH = Math.min(outH, 1 - clampedY)

  // If region is completely outside the zoom crop, skip it
  if (outX + outW <= 0 || outY + outH <= 0 || outX >= 1 || outY >= 1) {
    return undefined
  }

  return { x: clampedX, y: clampedY, w: clampedW, h: clampedH }
}

// ============================================================================
// LAYOUT COMPILATION
// ============================================================================

/**
 * Compile a layout decision into FFmpeg filter string.
 *
 * @param layout - Layout type to compile
 * @param params - Layout-specific parameters
 * @param webcamRegion - Detected webcam region (required for webcam layouts)
 * @param outputDims - Target output dimensions
 * @param inputLabel - FFmpeg input stream label (e.g., "[0:v]")
 * @param outputLabel - FFmpeg output stream label (e.g., "[v0]")
 * @param segIdx - Unique segment index for internal label disambiguation
 */
function compileLayout(
  layout: LayoutType,
  params: Record<string, unknown>,
  webcamRegion: WebcamRegion | undefined,
  outputDims: OutputDimensions,
  inputLabel: string,
  outputLabel: string,
  segIdx: number,
  targetAspectRatio?: string,
  sourceWidth?: number,
): string {
  const { width: outW, height: outH } = outputDims
  const srcW = sourceWidth ?? 1920
  const midX = Math.round(srcW / 2)

  switch (layout) {
    case 'only_webcam': {
      // Crop to webcam region, scale to fill output (no stretch distortion)
      if (!webcamRegion) {
        return `${inputLabel}crop=iw/4:ih/4:3*iw/4:0,scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}${outputLabel}`
      }
      const p = params as OnlyWebcamParams
      const scale = p.scale ?? 1.0
      const { x, y, width, height } = webcamRegion
      const cropW = Math.round(width / scale)
      const cropH = Math.round(height / scale)
      const cropX = x + Math.round((width - cropW) / 2)
      const cropY = y + Math.round((height - cropH) / 2)
      // Scale up to fill the target, then center-crop overflow (no AR distortion)
      return `${inputLabel}crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}${outputLabel}`
    }

    case 'only_screen': {
      // Crop to screen region (everything except webcam), scale to fill
      if (!webcamRegion) {
        return `${inputLabel}scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}${outputLabel}`
      }
      const { x, width: wcW } = webcamRegion
      const isWebcamRight = x > midX
      const screenCropX = isWebcamRight ? 0 : wcW
      const screenCropW = isWebcamRight ? x : `iw-${wcW}`
      return `${inputLabel}crop=${screenCropW}:ih:${screenCropX}:0,scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}${outputLabel}`
    }

    case 'split_layout': {
      // For 16:9 (landscape) target: show the original frame scaled to fit — no split
      if (!targetAspectRatio || targetAspectRatio === '16:9') {
        return `${inputLabel}scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:black${outputLabel}`
      }

      // For non-16:9 targets (portrait/square/feed): vstack screen + webcam
      const p = params as SplitLayoutParams
      const screenPercent = p.screenPercent ?? 65
      const screenH = Math.round((outH * screenPercent) / 100)
      const camH = outH - screenH

      // Use segIdx for unique intermediate labels to avoid collisions
      const scrLabel = `[scr${segIdx}]`
      const camLabel = `[cam${segIdx}]`
      const screenLabel = `[screen${segIdx}]`
      const webcamLabel = `[webcam${segIdx}]`

      if (!webcamRegion) {
        // Fallback: split frame horizontally, screen on top
        return `${inputLabel}split${scrLabel}${camLabel};` +
          `${scrLabel}crop=iw:ih*0.7:0:0,scale=${outW}:${screenH}:force_original_aspect_ratio=increase,crop=${outW}:${screenH}${screenLabel};` +
          `${camLabel}crop=iw/3:ih*0.3:2*iw/3:ih*0.7,scale=${outW}:${camH}:force_original_aspect_ratio=increase,crop=${outW}:${camH}${webcamLabel};` +
          `${screenLabel}${webcamLabel}vstack${outputLabel}`
      }

      const { x, y, width: wcW, height: wcH } = webcamRegion
      // Screen crop: exclude webcam columns
      const isWebcamRight = x > midX
      const screenCropX = isWebcamRight ? 0 : wcW
      const screenCropW = isWebcamRight ? x : `iw-${wcW}`

      // Scale each section to fill its slice, then crop overflow (no black gaps)
      return `${inputLabel}split${scrLabel}${camLabel};` +
        `${scrLabel}crop=${screenCropW}:ih:${screenCropX}:0,scale=${outW}:${screenH}:force_original_aspect_ratio=increase,crop=${outW}:${screenH}${screenLabel};` +
        `${camLabel}crop=${wcW}:${wcH}:${x}:${y},scale=${outW}:${camH}:force_original_aspect_ratio=increase,crop=${outW}:${camH}${webcamLabel};` +
        `${screenLabel}${webcamLabel}vstack${outputLabel}`
    }

    case 'zoom_webcam': {
      // Crop webcam, apply scale zoom, center
      const p = params as ZoomWebcamParams
      const scale = p.scale ?? 1.5
      const centerX = p.centerX ?? 0.5
      const centerY = p.centerY ?? 0.5

      if (!webcamRegion) {
        return `${inputLabel}crop=iw/4:ih/4:3*iw/4:0,scale=${outW}:${outH}${outputLabel}`
      }

      const { x, y, width: wcW, height: wcH } = webcamRegion
      // Calculate zoom crop within webcam region
      const zoomW = Math.round(wcW / scale)
      const zoomH = Math.round(wcH / scale)
      const zoomX = x + Math.round((wcW - zoomW) * centerX)
      const zoomY = y + Math.round((wcH - zoomH) * centerY)

      return `${inputLabel}crop=${zoomW}:${zoomH}:${zoomX}:${zoomY},scale=${outW}:${outH}${outputLabel}`
    }

    case 'zoom_screen': {
      // Crop screen region (excluding webcam), then zoom to fill output
      const p = params as ZoomScreenParams
      const scale = p.scale ?? 1.5
      const region = p.region

      if (region && typeof region.x === 'number' && typeof region.y === 'number') {
        // Zoom to specific normalized region — scale to fill, crop overflow
        const cropX = `iw*${region.x.toFixed(3)}`
        const cropY = `ih*${region.y.toFixed(3)}`
        const cropW = `iw*${region.width.toFixed(3)}`
        const cropH = `ih*${region.height.toFixed(3)}`
        return `${inputLabel}crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}${outputLabel}`
      }

      if (webcamRegion) {
        // First exclude the webcam columns, then zoom into center of screen area
        const { x: wcX, width: wcW } = webcamRegion
        const isWebcamRight = wcX > midX
        const screenCropX = isWebcamRight ? 0 : wcW
        const screenW = isWebcamRight ? wcX : `iw-${wcW}`

        // Zoom into center of screen-only region, scale to fill (no letterboxing)
        const zoomFactor = 1 / scale
        const zoomOffsetX = (1 - zoomFactor) / 2
        const zoomOffsetY = (1 - zoomFactor) / 2
        return `${inputLabel}crop=${screenW}:ih:${screenCropX}:0,crop=iw*${zoomFactor.toFixed(3)}:ih*${zoomFactor.toFixed(3)}:iw*${zoomOffsetX.toFixed(3)}:ih*${zoomOffsetY.toFixed(3)},scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}${outputLabel}`
      }

      // Zoom to center, scale to fill
      const zoomFactor = 1 / scale
      const offset = (1 - zoomFactor) / 2
      return `${inputLabel}crop=iw*${zoomFactor.toFixed(3)}:ih*${zoomFactor.toFixed(3)}:iw*${offset.toFixed(3)}:ih*${offset.toFixed(3)},scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}${outputLabel}`
    }
  }
}

// ============================================================================
// TRANSITION COMPILATION
// ============================================================================

/**
 * Compile a transition between two segments.
 *
 * @param transition - Transition type
 * @param params - Transition-specific parameters
 * @param prevLabel - Label of the previous segment's output
 * @param nextLabel - Label of the next segment's input
 * @param outputLabel - Label for the transitioned output
 * @param offset - Time offset where transition starts (seconds)
 */
function compileTransition(
  transition: TransitionType,
  params: Record<string, unknown>,
  prevLabel: string,
  nextLabel: string,
  outputLabel: string,
  offset: number,
): string | null {
  switch (transition) {
    case 'cut':
      // No filter needed for hard cut
      return null

    case 'fade': {
      const p = params as FadeParams
      const duration = p.duration ?? 0.5
      return `[${prevLabel}][${nextLabel}]xfade=transition=fade:duration=${duration.toFixed(3)}:offset=${offset.toFixed(3)}${outputLabel}`
    }

    case 'swipe': {
      const p = params as SwipeParams
      const duration = p.duration ?? 0.3
      const transitionName = getSwipeTransition(p.direction)
      return `[${prevLabel}][${nextLabel}]xfade=transition=${transitionName}:duration=${duration.toFixed(3)}:offset=${offset.toFixed(3)}${outputLabel}`
    }

    case 'zoom_transition': {
      const p = params as ZoomTransitionParams
      const duration = p.duration ?? 0.5
      const scale = p.scale ?? 1.5
      const blur = p.blur ?? true
      // Custom zoom+blur using zoompan and boxblur chained with xfade
      // For simplicity, use a radial wipe which gives a zoom-like effect
      // A true zoom blur would require complex filter chains
      if (blur) {
        return `[${prevLabel}][${nextLabel}]xfade=transition=radial:duration=${duration.toFixed(3)}:offset=${offset.toFixed(3)}${outputLabel}`
      }
      return `[${prevLabel}][${nextLabel}]xfade=transition=radial:duration=${duration.toFixed(3)}:offset=${offset.toFixed(3)}${outputLabel}`
    }
  }
}

// ============================================================================
// EFFECT COMPILATION
// ============================================================================

/**
 * Compile an effect into an FFmpeg filter string.
 *
 * @param effect - Effect type
 * @param params - Effect-specific parameters
 * @param startTime - When effect begins (seconds)
 * @param endTime - When effect ends (seconds)
 */
function compileEffect(
  effect: EffectType,
  params: Record<string, unknown>,
  startTime: number,
  endTime?: number,
  fontPath?: string,
  zoomSegments?: readonly ZoomSegment[],
): string {
  switch (effect) {
    case 'text_overlay': {
      const p = params as TextOverlayParams
      // Escape text for filter option level (\' for ', \: for :, \\ for \)
      const text = escapeDrawtext(p.text)
      const fontSize = p.fontSize ?? 48
      const color = (p.color ?? '#FFFFFF').replace('#', '0x')
      const position = getTextPosition(p.position, fontSize)
      const bgColor = p.backgroundColor ? `:box=1:boxcolor=${p.backgroundColor.replace('#', '0x')}` : ''
      // Escape : in fontfile path for filter option parser
      const fontFile = fontPath ? `:fontfile=${escapeFFmpegPath(fontPath)}` : ''
      const animation = p.animation ?? 'none'

      // Enable filter only during the specified time range
      const enable = endTime ? `enable='between(t,${startTime.toFixed(3)},${endTime.toFixed(3)})'` : `enable='gte(t,${startTime.toFixed(3)})'`

      // Build animation-specific overrides
      let alphaExpr = ''
      let yExpr = position.y
      let fontSizeExpr = `${fontSize}`

      const animDuration = 0.4

      if (animation === 'fade-in') {
        // Ramp alpha from 0 to 1 over animDuration seconds
        alphaExpr = `:alpha='if(lt(t,${(startTime + animDuration).toFixed(3)}),min(1,(t-${startTime.toFixed(3)})/${animDuration.toFixed(3)}),1)'`
      } else if (animation === 'slide-up') {
        // Slide from 60px below target position to target over animDuration
        const slideDistance = 60
        yExpr = `if(lt(t\\,${(startTime + animDuration).toFixed(3)})\\,${position.y}+${slideDistance}*(1-(t-${startTime.toFixed(3)})/${animDuration.toFixed(3)})\\,${position.y})`
      } else if (animation === 'pop') {
        // FFmpeg 8.x drawtext fontsize= doesn't safely support per-frame
        // expressions (segfault with if()/lt()). Use a slightly larger static
        // size to approximate the pop effect.
        fontSizeExpr = `${Math.round(fontSize * 1.15)}`
      }

      return `drawtext=text=${text}:fontsize=${fontSizeExpr}:fontcolor=${color}${fontFile}:x=${position.x}:y=${yExpr}${bgColor}${alphaExpr}:${enable}`
    }

    case 'highlight_region': {
      const p = params as HighlightRegionParams
      const color = (p.color ?? '#FF0000').replace('#', '0x')
      const borderWidth = p.borderWidth ?? 3
      const enable = endTime ? `enable='between(t,${startTime.toFixed(3)},${endTime.toFixed(3)})'` : `enable='gte(t,${startTime.toFixed(3)})'`
      const animation = p.animation ?? 'none'

      // Start with source-space coordinates (normalized 0-1 or pixel)
      const isNormalized = p.x <= 1.0 && p.y <= 1.0 && p.width <= 1.0 && p.height <= 1.0
      let cx = isNormalized ? p.x : p.x / 1920 // normalize pixel coords to 0-1
      let cy = isNormalized ? p.y : p.y / 1080
      let cw = isNormalized ? p.width : p.width / 1920
      let ch = isNormalized ? p.height : p.height / 1080

      // Transform coordinates if a zoom layout is active during this effect
      if (zoomSegments && zoomSegments.length > 0) {
        const midTime = endTime ? (startTime + endTime) / 2 : startTime
        const activeZoom = zoomSegments.find(z => midTime >= z.concatStart && midTime < z.concatEnd)
        if (activeZoom) {
          const zoomRect = getZoomCropRect(activeZoom.layout, activeZoom.params, activeZoom.webcamRegion, activeZoom.sourceWidth)
          if (zoomRect) {
            const transformed = transformCoordsForZoom({ x: cx, y: cy, w: cw, h: ch }, zoomRect)
            if (!transformed) {
              // Region is completely outside zoom crop — skip this effect
              logger.debug(`[EDL Compiler] highlight_region at t=${startTime.toFixed(3)} is outside zoom crop, skipping`)
              return ''
            }
            cx = transformed.x
            cy = transformed.y
            cw = transformed.w
            ch = transformed.h
            logger.debug(`[EDL Compiler] highlight_region transformed for zoom: (${p.x},${p.y}) → (${cx.toFixed(3)},${cy.toFixed(3)})`)
          }
        }
      }

      // Convert to FFmpeg expressions (always normalized after transform)
      const xExpr = `iw*${cx.toFixed(3)}`
      const yExpr = `ih*${cy.toFixed(3)}`
      const wExpr = `iw*${cw.toFixed(3)}`
      const hExpr = `ih*${ch.toFixed(3)}`

      let filter: string

      if (animation === 'pulse') {
        // FFmpeg drawbox t= doesn't support expression functions (abs/sin).
        // Use a fixed max thickness for the pulse effect instead.
        const maxThickness = borderWidth * 3
        filter = `drawbox=x=${xExpr}:y=${yExpr}:w=${wExpr}:h=${hExpr}:color=${color}:t=${maxThickness}:${enable}`
      } else if (animation === 'draw') {
        // Progressive border reveal — animate width from 0 to full over 0.5s
        const drawDur = 0.5
        const animW = `min(${wExpr}\\,(${wExpr})*(t-${startTime.toFixed(3)})/${drawDur.toFixed(3)})`
        filter = `drawbox=x=${xExpr}:y=${yExpr}:w=${animW}:h=${hExpr}:color=${color}:t=${borderWidth}:${enable}`
      } else {
        filter = `drawbox=x=${xExpr}:y=${yExpr}:w=${wExpr}:h=${hExpr}:color=${color}:t=${borderWidth}:${enable}`
      }

      // dimOutside: draw a semi-transparent black fill, then punch a hole
      if (p.dimOutside) {
        const dimEnable = enable
        // Draw a full-frame semi-transparent black box first, then the highlight on top
        filter = `drawbox=x=0:y=0:w=iw:h=ih:color=black@0.5:t=fill:${dimEnable},${filter}`
      }

      return filter
    }

    case 'slow_motion': {
      const p = params as SlowMotionParams
      const speed = p.speed
      // setpts filter to change playback speed
      // speed < 1 = slower, speed > 1 = faster
      const ptsFactor = 1 / speed
      return `setpts=${ptsFactor.toFixed(3)}*PTS`
    }

    case 'b_roll': {
      // B-roll uses an additional input — the inputIndex is set by compileEdl()
      const p = params as BRollParams
      const inputIndex = (params as Record<string, unknown>).__inputIndex as number | undefined
      if (!inputIndex || !p.imagePath) return ''

      const displayMode = p.displayMode ?? 'fullscreen'
      const enable = endTime ? `enable='between(t,${startTime.toFixed(3)},${endTime.toFixed(3)})'` : `enable='gte(t,${startTime.toFixed(3)})'`

      if (displayMode === 'picture-in-picture') {
        const pipSize = p.pipSize ?? 25
        const pos = p.pipPosition ?? 'bottom-right'
        const scale = `[${inputIndex}:v]scale=iw*${pipSize}/100:-1[broll${inputIndex}]`
        // Position based on pipPosition
        let overlayPos: string
        switch (pos) {
          case 'top-left': overlayPos = 'x=10:y=10'; break
          case 'top-right': overlayPos = 'x=W-w-10:y=10'; break
          case 'bottom-left': overlayPos = 'x=10:y=H-h-10'; break
          case 'bottom-right': default: overlayPos = 'x=W-w-10:y=H-h-10'; break
        }
        // Return comma-separated: the scale is prepended as a separate filter line by compileEdl
        return `overlay=${overlayPos}:${enable}`
      } else {
        // fullscreen: overlay scaled to fill
        return `overlay=0:0:${enable}`
      }
    }

    case 'fade_to_black': {
      const p = params as FadeToBlackParams
      const duration = p.duration ?? 1.0
      return `fade=type=out:start_time=${startTime.toFixed(3)}:duration=${duration.toFixed(3)}:color=black`
    }
  }
}

// ============================================================================
// MAIN COMPILER
// ============================================================================

/**
 * Compile an EditDecisionList into FFmpeg commands.
 *
 * The compiler:
 * 1. Groups decisions by time segments
 * 2. Compiles layouts for each segment
 * 3. Chains transitions between segments
 * 4. Overlays effects on top
 * 5. Optimizes for single-pass encoding
 */
export function compileEdl(edl: EditDecisionList): CompileResult {
  const { decisions, webcamRegion, metadata } = edl

  logger.info(`[EDL Compiler] Compiling ${decisions.length} decisions (webcam: ${webcamRegion ? 'detected' : 'none'})`)

  // Default output dimensions
  const outputDims: OutputDimensions = {
    width: metadata?.outputWidth ?? 1920,
    height: metadata?.outputHeight ?? 1080,
  }

  const targetAspectRatio = metadata?.targetAspectRatio
  logger.debug(`[EDL Compiler] Output: ${outputDims.width}x${outputDims.height}, targetAR: ${targetAspectRatio ?? 'default (16:9)'}`)

  // Sort decisions by start time
  const sortedDecisions = [...decisions].sort((a, b) => a.startTime - b.startTime)

  // Separate decision types
  const layouts = sortedDecisions.filter(d => d.type === 'layout') as LayoutDecision[]
  const transitions = sortedDecisions.filter(d => d.type === 'transition') as TransitionDecision[]
  const effects = sortedDecisions.filter(d => d.type === 'effect') as EffectDecision[]

  logger.info(`[EDL Compiler] ${layouts.length} layouts, ${transitions.length} transitions, ${effects.length} effects`)

  // Debug: log each decision
  for (const d of sortedDecisions) {
    logger.debug(`[EDL Compiler]   decision: type=${d.type} tool=${d.tool} t=${d.startTime.toFixed(3)}-${d.endTime?.toFixed(3) ?? '?'} params=${JSON.stringify(d.params)}`)
  }

  const filterParts: string[] = []
  const segmentLabels: string[] = []
  const audioLabels: string[] = []
  let segmentIndex = 0

  // If no layouts, use full video as single segment
  if (layouts.length === 0) {
    filterParts.push(`[0:v]copy[v0]`)
    segmentLabels.push('v0')
    // No audio trim needed — pass through entire audio
  } else {
    // Compile each layout segment
    for (let i = 0; i < layouts.length; i++) {
      const layout = layouts[i]
      const nextLayout = layouts[i + 1]

      const startTime = layout.startTime
      const endTime = layout.endTime ?? nextLayout?.startTime ?? (metadata?.sourceDuration ?? 3600)

      // Trim the video segment and normalize timebase
      const trimLabel = `[trim${segmentIndex}]`
      const trimFilter = `[0:v]trim=start=${startTime.toFixed(3)}:end=${endTime.toFixed(3)},setpts=PTS-STARTPTS,fps=30${trimLabel}`
      filterParts.push(trimFilter)
      logger.debug(`[EDL Compiler] seg[${segmentIndex}] TRIM: ${trimFilter}`)

      // Apply layout transformation
      const layoutLabel = `[v${segmentIndex}]`
      const layoutFilter = compileLayout(
        layout.tool as LayoutType,
        layout.params,
        webcamRegion,
        outputDims,
        trimLabel,
        layoutLabel,
        segmentIndex,
        targetAspectRatio,
        metadata?.sourceWidth,
      )
      filterParts.push(layoutFilter)
      logger.debug(`[EDL Compiler] seg[${segmentIndex}] LAYOUT (${layout.tool}): ${layoutFilter}`)
      segmentLabels.push(`v${segmentIndex}`)

      // Parallel audio trim for this segment (keeps audio in sync with video)
      const audioTrimFilter = `[0:a]atrim=start=${startTime.toFixed(3)}:end=${endTime.toFixed(3)},asetpts=PTS-STARTPTS[a${segmentIndex}]`
      filterParts.push(audioTrimFilter)
      logger.debug(`[EDL Compiler] seg[${segmentIndex}] AUDIO: ${audioTrimFilter}`)
      audioLabels.push(`a${segmentIndex}`)

      segmentIndex++
    }
  }

  // Chain segments together (transitions + concat for non-transitioned boundaries)
  if (segmentLabels.length > 1) {
    // Calculate segment durations for transition offsets
    const segmentDurations: number[] = []
    for (let i = 0; i < layouts.length; i++) {
      const layout = layouts[i]
      const nextLayout = layouts[i + 1]
      const duration = (layout.endTime ?? nextLayout?.startTime ?? (metadata?.sourceDuration ?? 3600)) - layout.startTime
      segmentDurations.push(duration)
    }

    let prevLabel = segmentLabels[0]
    let prevAudioLabel = audioLabels[0]
    let cumulativeDuration = segmentDurations[0]
    let cumulativeAudioDuration = segmentDurations[0]

    for (let i = 1; i < segmentLabels.length; i++) {
      // Find transition for this boundary
      const boundary = layouts[i]?.startTime ?? 0
      const transition = transitions.find(t => Math.abs(t.startTime - boundary) < 0.5)

      const isLast = i === segmentLabels.length - 1
      const outputLabel = isLast ? '[vmerged]' : `[chain${i}]`
      const audioOutputLabel = isLast ? '[amerged]' : `[achain${i}]`

      if (transition && transition.tool !== 'cut') {
        // Apply xfade transition
        const transitionDuration = (transition.params as FadeParams).duration ?? 0.5
        const offset = Math.max(0, cumulativeDuration - transitionDuration)
        logger.debug(`[EDL Compiler] chain[${i}] TRANSITION (${transition.tool}): dur=${transitionDuration.toFixed(3)} offset=${offset.toFixed(3)} [${prevLabel}]+[${segmentLabels[i]}]->${outputLabel}`)

        const transitionFilter = compileTransition(
          transition.tool as TransitionType,
          transition.params,
          prevLabel,
          segmentLabels[i],
          outputLabel,
          offset,
        )

        if (transitionFilter) {
          filterParts.push(transitionFilter)
          logger.debug(`[EDL Compiler] chain[${i}] XFADE: ${transitionFilter}`)
          prevLabel = outputLabel.slice(1, -1)
          cumulativeDuration = cumulativeDuration - transitionDuration + segmentDurations[i]
        }

        // Audio: trim transitionDuration from the end of accumulated audio,
        // then concat with the next segment. This matches xfade's overlap
        // behavior (which shortens total video by transitionDuration) without
        // blending speech.
        const trimmedEnd = Math.max(0, cumulativeAudioDuration - transitionDuration)
        const aTrimLabel = `[atrim${i}]`
        filterParts.push(
          `[${prevAudioLabel}]atrim=end=${trimmedEnd.toFixed(3)},asetpts=PTS-STARTPTS${aTrimLabel}`,
        )
        filterParts.push(
          `${aTrimLabel}[${audioLabels[i]}]concat=n=2:v=0:a=1${audioOutputLabel}`,
        )
        prevAudioLabel = audioOutputLabel.slice(1, -1)
        cumulativeAudioDuration = trimmedEnd + segmentDurations[i]
      } else {
        // No transition (or hard cut) — concat the two segments
        // Add fps=30 after concat to normalize timebase (concat resets to 1/1000000
        // which causes xfade mismatch if a later boundary uses a transition)
        logger.debug(`[EDL Compiler] chain[${i}] HARD CUT: [${prevLabel}]+[${segmentLabels[i]}]->${outputLabel}`)
        const concatOut = isLast ? outputLabel : `[concatraw${i}]`
        filterParts.push(`[${prevLabel}][${segmentLabels[i]}]concat=n=2:v=1:a=0${concatOut}`)
        if (!isLast) {
          filterParts.push(`${concatOut}fps=30${outputLabel}`)
        }
        prevLabel = outputLabel.slice(1, -1)
        cumulativeDuration += segmentDurations[i]

        // Audio: concat to match video hard cut
        filterParts.push(
          `[${prevAudioLabel}][${audioLabels[i]}]concat=n=2:v=0:a=1${audioOutputLabel}`,
        )
        prevAudioLabel = audioOutputLabel.slice(1, -1)
        cumulativeAudioDuration += segmentDurations[i]
      }
    }

    // Replace labels with the final merged labels
    segmentLabels.splice(0, segmentLabels.length, prevLabel)
    audioLabels.splice(0, audioLabels.length, prevAudioLabel)
  }

  // Determine the video output label before effects
  let videoOutput = segmentLabels.length === 1 ? segmentLabels[0] : 'vmerged'

  // Build zoom context for coordinate transformation of highlight_region effects.
  // Maps each segment's time range in the concat timeline to its layout/zoom params.
  const zoomSegments: ZoomSegment[] = []
  if (layouts.length > 0) {
    const segDurations: number[] = []
    for (let i = 0; i < layouts.length; i++) {
      const layout = layouts[i]
      const nextLayout = layouts[i + 1]
      segDurations.push((layout.endTime ?? nextLayout?.startTime ?? (metadata?.sourceDuration ?? 3600)) - layout.startTime)
    }

    let concatOffset = 0
    for (let i = 0; i < layouts.length; i++) {
      const layout = layouts[i]
      const segEnd = concatOffset + segDurations[i]

      // Account for xfade overlap reducing concat duration
      let xfadeDur = 0
      if (i > 0) {
        const boundary = layout.startTime
        const tr = transitions.find(t => Math.abs(t.startTime - boundary) < 0.5)
        if (tr && tr.tool !== 'cut') {
          xfadeDur = (tr.params as FadeParams).duration ?? 0.5
        }
      }

      const actualStart = i === 0 ? 0 : concatOffset - xfadeDur
      zoomSegments.push({
        concatStart: actualStart,
        concatEnd: actualStart + segDurations[i],
        layout: layout.tool as LayoutType,
        params: layout.params,
        webcamRegion,
        sourceWidth: metadata?.sourceWidth,
      })
      concatOffset = segEnd - xfadeDur
    }
  }

  // Apply effects as overlay filters
  if (effects.length > 0) {
    const effectFilters: string[] = []
    for (const effect of effects) {
      if (effect.tool === 'b_roll') continue // Skip b_roll (needs separate input)
      const effectFilter = compileEffect(
        effect.tool as EffectType,
        effect.params,
        effect.startTime,
        effect.endTime,
        metadata?.fontPath,
        zoomSegments,
      )
      if (effectFilter) {
        logger.debug(`[EDL Compiler] EFFECT (${effect.tool}): t=${effect.startTime.toFixed(3)}-${effect.endTime?.toFixed(3) ?? '?'} → ${effectFilter}`)
        effectFilters.push(effectFilter)
      }
    }

    if (effectFilters.length > 0) {
      // Chain effects onto the video output
      const effectChain = `[${videoOutput}]${effectFilters.join(',')}[vout]`
      filterParts.push(effectChain)
      logger.debug(`[EDL Compiler] EFFECT CHAIN: ${effectChain}`)
      videoOutput = 'vout'
    }
  }

  // Handle b_roll effects — collect additional inputs
  const inputArgs: string[] = []
  const bRollEffects = effects.filter(e => e.tool === 'b_roll' && (e.params as BRollParams).imagePath)
  let nextInputIndex = 1 // 0 is the main video
  for (const broll of bRollEffects) {
    const p = broll.params as BRollParams
    inputArgs.push('-i', p.imagePath!)
    // Inject the input index into params for compileEffect
    ;(broll.params as Record<string, unknown>).__inputIndex = nextInputIndex

    const enable = broll.endTime
      ? `enable='between(t,${broll.startTime.toFixed(3)},${broll.endTime.toFixed(3)})'`
      : `enable='gte(t,${broll.startTime.toFixed(3)})'`

    const displayMode = p.displayMode ?? 'fullscreen'

    if (displayMode === 'picture-in-picture') {
      const pipSize = p.pipSize ?? 25
      const pos = p.pipPosition ?? 'bottom-right'
      let overlayPos: string
      switch (pos) {
        case 'top-left': overlayPos = 'x=10:y=10'; break
        case 'top-right': overlayPos = 'x=W-w-10:y=10'; break
        case 'bottom-left': overlayPos = 'x=10:y=H-h-10'; break
        case 'bottom-right': default: overlayPos = 'x=W-w-10:y=H-h-10'; break
      }
      // Scale b-roll image, then overlay on video
      const brollScaleLabel = `[broll${nextInputIndex}]`
      filterParts.push(`[${nextInputIndex}:v]scale=iw*${pipSize}/100:-1${brollScaleLabel}`)
      const overlayOutput = `[brollout${nextInputIndex}]`
      filterParts.push(`[${videoOutput}]${brollScaleLabel}overlay=${overlayPos}:${enable}${overlayOutput}`)
      videoOutput = overlayOutput.slice(1, -1)
    } else {
      // fullscreen: scale b-roll to output dims, overlay
      const brollScaleLabel = `[broll${nextInputIndex}]`
      filterParts.push(`[${nextInputIndex}:v]scale=${outputDims.width}:${outputDims.height}${brollScaleLabel}`)
      const overlayOutput = `[brollout${nextInputIndex}]`
      filterParts.push(`[${videoOutput}]${brollScaleLabel}overlay=0:0:${enable}${overlayOutput}`)
      videoOutput = overlayOutput.slice(1, -1)
    }

    nextInputIndex++
  }

  // Handle audio — use segment-trimmed audio when available, raw pass-through otherwise
  if (audioLabels.length > 0) {
    const mergedAudio = audioLabels[0]
    filterParts.push(`[${mergedAudio}]aresample=async=1[aout]`)
  } else {
    filterParts.push(`[0:a]aresample=async=1[aout]`)
  }

  // Add audio fade-out for fade_to_black effects
  const fadeToBlackEffects = effects.filter(e => e.tool === 'fade_to_black')
  let audioOutput = 'aout'
  if (fadeToBlackEffects.length > 0) {
    const ftb = fadeToBlackEffects[0] // Use first fade_to_black
    const p = ftb.params as FadeToBlackParams
    const duration = p.duration ?? 1.0
    filterParts.push(`[aout]afade=type=out:start_time=${ftb.startTime.toFixed(3)}:duration=${duration.toFixed(3)}[afaded]`)
    audioOutput = 'afaded'
  }

  // Build final filter_complex string
  const filterComplex = filterParts.join(';\n')

  logger.info(`[EDL Compiler] Compiled ${filterParts.length} filter parts, ${filterComplex.length} chars total`)
  // Always log the full filter_complex at debug level for diagnostics
  logger.debug(`[EDL Compiler] ── FULL filter_complex ──\n${filterComplex}\n── END filter_complex ──`)

  // Build output args — force yuv420p for broad player compatibility
  const outputArgs = [
    '-map', `[${videoOutput}]`,
    '-map', `[${audioOutput}]`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
  ]

  logger.info(`[EDL Compiler] Output: ${outputDims.width}x${outputDims.height}, map [${videoOutput}] + [aout]`)

  return {
    filterComplex,
    outputArgs,
    passes: 1, // Optimized for single-pass
    inputArgs,
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Escape special characters for FFmpeg filter strings.
 */
export function escapeFilterString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

/**
 * Parse a hex color string to FFmpeg format.
 */
export function parseColor(hex: string): string {
  return hex.replace('#', '0x')
}
