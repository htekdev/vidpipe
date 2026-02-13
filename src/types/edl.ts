/**
 * Edit Decision List (EDL) type definitions for vidpipe.
 *
 * The EDL system provides a declarative way to describe video edits that an
 * AI agent can produce. Instead of generating raw FFmpeg commands, agents
 * output structured edit decisions that the EDL compiler transforms into
 * optimized FFmpeg filter graphs.
 *
 * ### Architecture
 * 1. **Agent planning** — AI analyzes video and produces `EditDecision[]`
 * 2. **EDL compilation** — `edlCompiler.ts` transforms decisions into FFmpeg commands
 * 3. **Execution** — FFmpeg applies all edits in minimal passes
 *
 * ### Decision Types
 * - **Layout** — How webcam/screen content is composed (split, zoom, etc.)
 * - **Transition** — How to move between layouts (fade, swipe, cut)
 * - **Effect** — Overlays, highlights, speed changes, B-roll insertions
 *
 * ### Timestamp Convention
 * All `startTime` and `endTime` fields are in **seconds from the beginning
 * of the video** (floating-point, e.g. 12.345). This matches FFmpeg's
 * `-ss` / `-to` parameters and Whisper transcript timestamps.
 */

// ============================================================================
// LAYOUT TYPES
// ============================================================================

/**
 * Available layout modes for video composition.
 *
 * Layouts control how webcam and screen content are arranged in the frame.
 * The default is typically `split_layout` for tutorial/coding content.
 */
export type LayoutType =
  | 'only_webcam'
  | 'only_screen'
  | 'split_layout'
  | 'zoom_webcam'
  | 'zoom_screen';

/**
 * Parameters for `only_webcam` layout.
 *
 * Shows only the webcam feed, scaled to fill the full frame.
 * Useful for intro/outro segments or personal commentary.
 */
export interface OnlyWebcamParams {
  /** Optional scale factor (1.0 = fit to frame, >1.0 = crop edges) */
  scale?: number;
}

/**
 * Parameters for `only_screen` layout.
 *
 * Shows only the screen capture, scaled to fill the full frame.
 * Useful for detailed code walkthroughs or demos.
 */
export interface OnlyScreenParams {
  /** No additional parameters needed */
}

/**
 * Parameters for `split_layout` — the standard tutorial composition.
 *
 * Screen content fills the top portion, webcam in a smaller region below.
 * This is the default layout for most coding/tutorial content.
 */
export interface SplitLayoutParams {
  /**
   * Percentage of frame height for screen content (0-100).
   * Default: 65 (screen takes top 65%, webcam takes bottom 35%)
   */
  screenPercent?: number;
  /**
   * Position of webcam within its region.
   * Default: 'bottom-right'
   */
  webcamPosition?: 'bottom-left' | 'bottom-right' | 'bottom-center';
}

/**
 * Parameters for `zoom_webcam` layout.
 *
 * Zooms in on the webcam feed, cropping edges. Useful for emphasis
 * during personal moments or reactions.
 */
export interface ZoomWebcamParams {
  /**
   * Scale factor for zoom (1.0 = no zoom, 2.0 = 2x zoom).
   * Default: 1.5
   */
  scale: number;
  /** Optional center point for zoom (0-1, relative to frame) */
  centerX?: number;
  centerY?: number;
}

/**
 * Parameters for `zoom_screen` layout.
 *
 * Zooms in on a specific region of the screen capture.
 * Useful for highlighting code, UI elements, or terminal output.
 */
export interface ZoomScreenParams {
  /** Scale factor for zoom (1.0 = no zoom, 2.0 = 2x zoom) */
  scale: number;
  /**
   * Target region to zoom into (normalized 0-1 coordinates).
   * If not provided, zooms to center.
   */
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Union type mapping layout types to their parameter interfaces.
 */
export type LayoutParams =
  | { type: 'only_webcam'; params: OnlyWebcamParams }
  | { type: 'only_screen'; params: OnlyScreenParams }
  | { type: 'split_layout'; params: SplitLayoutParams }
  | { type: 'zoom_webcam'; params: ZoomWebcamParams }
  | { type: 'zoom_screen'; params: ZoomScreenParams };

// ============================================================================
// TRANSITION TYPES
// ============================================================================

/**
 * Available transition types between layouts or clips.
 *
 * Transitions define how to move from one layout/segment to another.
 * They're applied at the boundary between two edit decisions.
 */
export type TransitionType = 'fade' | 'swipe' | 'zoom_transition' | 'cut';

/** Direction for swipe transitions */
export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

/**
 * Parameters for `fade` transition (crossfade).
 *
 * Smoothly blends between two frames over the specified duration.
 */
export interface FadeParams {
  /**
   * Duration of the fade in seconds.
   * Default: 0.5
   */
  duration: number;
}

/**
 * Parameters for `swipe` transition.
 *
 * The new content slides in from the specified direction,
 * pushing the old content out.
 */
export interface SwipeParams {
  /**
   * Direction the new content enters from.
   * 'left' means new content enters from left edge.
   */
  direction: SwipeDirection;
  /**
   * Duration of the swipe in seconds.
   * Default: 0.3
   */
  duration?: number;
}

/**
 * Parameters for `zoom_transition` (zoom blur).
 *
 * Zooms into the frame while applying a blur, then zooms out
 * to reveal the new content. Creates a dramatic transition.
 */
export interface ZoomTransitionParams {
  /**
   * Maximum zoom scale at the midpoint.
   * Default: 1.5
   */
  scale?: number;
  /**
   * Duration of the full transition in seconds.
   * Default: 0.5
   */
  duration?: number;
  /**
   * Whether to apply blur during zoom.
   * Default: true
   */
  blur?: boolean;
}

/**
 * Parameters for `cut` transition (hard cut).
 *
 * Instant switch with no transition effect. No parameters needed.
 */
export interface CutParams {
  /** No parameters — instant cut */
}

/**
 * Union type mapping transition types to their parameter interfaces.
 */
export type TransitionParams =
  | { type: 'fade'; params: FadeParams }
  | { type: 'swipe'; params: SwipeParams }
  | { type: 'zoom_transition'; params: ZoomTransitionParams }
  | { type: 'cut'; params: CutParams };

// ============================================================================
// EFFECT TYPES
// ============================================================================

/**
 * Available effect types for video enhancement.
 *
 * Effects are overlays or modifications applied to the video
 * for a specific time range.
 */
export type EffectType =
  | 'text_overlay'
  | 'highlight_region'
  | 'slow_motion'
  | 'b_roll'
  | 'fade_to_black';

/** Position presets for text overlays */
export type TextPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/**
 * Parameters for `text_overlay` effect.
 *
 * Adds text to the video for the duration of the edit decision.
 * Useful for titles, callouts, or annotations.
 */
export interface TextOverlayParams {
  /** The text to display */
  text: string;
  /**
   * Position of the text on screen.
   * Default: 'bottom-center'
   */
  position: TextPosition;
  /**
   * Font size in pixels.
   * Default: 48
   */
  fontSize?: number;
  /**
   * Text color in hex format (e.g., '#FFFFFF').
   * Default: '#FFFFFF'
   */
  color?: string;
  /**
   * Background color with alpha (e.g., '#00000080').
   * Default: transparent
   */
  backgroundColor?: string;
  /**
   * Animation style for text appearance.
   * Default: 'none'
   */
  animation?: 'none' | 'fade-in' | 'slide-up' | 'pop';
}

/**
 * Parameters for `highlight_region` effect.
 *
 * Draws a highlight box around a region of the screen.
 * Useful for drawing attention to UI elements or code.
 */
export interface HighlightRegionParams {
  /** X coordinate of highlight box (pixels from left) */
  x: number;
  /** Y coordinate of highlight box (pixels from top) */
  y: number;
  /** Width of highlight box in pixels */
  width: number;
  /** Height of highlight box in pixels */
  height: number;
  /**
   * Border color in hex format.
   * Default: '#FF0000' (red)
   */
  color?: string;
  /**
   * Border thickness in pixels.
   * Default: 3
   */
  borderWidth?: number;
  /**
   * Whether to dim areas outside the highlight.
   * Default: false
   */
  dimOutside?: boolean;
  /**
   * Animation style for highlight appearance.
   * Default: 'none'
   */
  animation?: 'none' | 'pulse' | 'draw';
}

/**
 * Parameters for `slow_motion` effect.
 *
 * Changes playback speed for the duration of this decision.
 * Audio is stretched accordingly (or muted for very slow speeds).
 */
export interface SlowMotionParams {
  /**
   * Playback speed multiplier.
   * 0.5 = half speed (slow-mo), 2.0 = double speed (fast forward)
   * Range: 0.25 to 4.0
   */
  speed: number;
  /**
   * Whether to preserve audio pitch when slowing down.
   * Default: true (for speeds >= 0.5)
   */
  preservePitch?: boolean;
}

/**
 * Parameters for `b_roll` effect.
 *
 * Inserts an image or video clip over the main content.
 * Can be generated via AI (imagePrompt) or use an existing file.
 */
export interface BRollParams {
  /**
   * Prompt for AI image generation (e.g., DALL-E).
   * Mutually exclusive with `imagePath`.
   */
  imagePrompt?: string;
  /**
   * Path to an existing image or video file.
   * Mutually exclusive with `imagePrompt`.
   */
  imagePath?: string;
  /**
   * How to display the B-roll content.
   * - 'fullscreen' — replaces main video entirely
   * - 'picture-in-picture' — small overlay in corner
   * - 'split' — side-by-side with main video
   * Default: 'fullscreen'
   */
  displayMode?: 'fullscreen' | 'picture-in-picture' | 'split';
  /**
   * Position for picture-in-picture mode.
   * Default: 'bottom-right'
   */
  pipPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /**
   * Size of PiP as percentage of frame width.
   * Default: 25
   */
  pipSize?: number;
}

/**
 * Parameters for `fade_to_black` effect.
 *
 * Fades the video to black at the specified start time.
 * Useful for endings and scene transitions.
 */
export interface FadeToBlackParams {
  /**
   * Duration of the fade in seconds.
   * Default: 1.0
   */
  duration?: number;
}

/**
 * Union type mapping effect types to their parameter interfaces.
 */
export type EffectParams =
  | { type: 'text_overlay'; params: TextOverlayParams }
  | { type: 'highlight_region'; params: HighlightRegionParams }
  | { type: 'slow_motion'; params: SlowMotionParams }
  | { type: 'b_roll'; params: BRollParams }
  | { type: 'fade_to_black'; params: FadeToBlackParams };

// ============================================================================
// EDIT DECISION
// ============================================================================

/** The category of edit decision */
export type EditDecisionType = 'layout' | 'transition' | 'effect';

/**
 * Base interface for all edit decisions.
 *
 * An edit decision represents a single discrete edit to be applied
 * to the video. Decisions are collected into an EDL and compiled
 * into FFmpeg commands.
 *
 * @property id - Unique identifier for this decision (e.g., "layout-1", "effect-zoom-5")
 * @property type - Category: 'layout', 'transition', or 'effect'
 * @property tool - Specific tool within the category (e.g., 'zoom_webcam', 'fade')
 * @property startTime - When this edit begins (seconds from video start)
 * @property endTime - When this edit ends (seconds). Optional for instantaneous edits.
 * @property params - Tool-specific parameters (type varies by tool)
 */
export interface EditDecision {
  id: string;
  type: EditDecisionType;
  tool: string;
  startTime: number;
  endTime?: number;
  params: Record<string, unknown>;
}

/**
 * Strongly-typed layout decision.
 */
export interface LayoutDecision extends Omit<EditDecision, 'type' | 'tool' | 'params'> {
  type: 'layout';
  tool: LayoutType;
  params: OnlyWebcamParams | OnlyScreenParams | SplitLayoutParams | ZoomWebcamParams | ZoomScreenParams;
}

/**
 * Strongly-typed transition decision.
 */
export interface TransitionDecision extends Omit<EditDecision, 'type' | 'tool' | 'params'> {
  type: 'transition';
  tool: TransitionType;
  params: FadeParams | SwipeParams | ZoomTransitionParams | CutParams;
}

/**
 * Strongly-typed effect decision.
 */
export interface EffectDecision extends Omit<EditDecision, 'type' | 'tool' | 'params'> {
  type: 'effect';
  tool: EffectType;
  params: TextOverlayParams | HighlightRegionParams | SlowMotionParams | BRollParams | FadeToBlackParams;
}

/**
 * Union of all strongly-typed decision types.
 */
export type TypedEditDecision = LayoutDecision | TransitionDecision | EffectDecision;

// ============================================================================
// WEBCAM REGION (from face detection)
// ============================================================================

/**
 * Detected webcam region within a screen recording.
 *
 * When processing screen recordings that include a webcam overlay,
 * face detection identifies where the webcam feed appears in the frame.
 * This region is used for:
 * - Extracting webcam content for `only_webcam` layout
 * - Positioning webcam in `split_layout`
 * - Smart cropping for portrait variants
 *
 * Coordinates are in pixels, relative to the source video dimensions.
 */
export interface WebcamRegion {
  /** X coordinate of top-left corner (pixels from left edge) */
  x: number;
  /** Y coordinate of top-left corner (pixels from top edge) */
  y: number;
  /** Width of webcam region in pixels */
  width: number;
  /** Height of webcam region in pixels */
  height: number;
  /**
   * Confidence score from face detection (0-1).
   * Higher values indicate more certain detection.
   */
  confidence?: number;
  /**
   * Whether this region was manually specified vs auto-detected.
   * Default: false (auto-detected)
   */
  manual?: boolean;
}

// ============================================================================
// EDIT DECISION LIST (EDL)
// ============================================================================

/**
 * Complete Edit Decision List for a video.
 *
 * The EDL is the primary data structure passed to the EDL compiler.
 * It contains all edit decisions plus metadata needed for processing.
 *
 * @property decisions - Array of edit decisions in chronological order
 * @property sourceVideo - Path to the source video file
 * @property outputPath - Path where the edited video should be written
 * @property webcamRegion - Detected webcam region (if applicable)
 * @property metadata - Optional additional metadata for the edit
 */
export interface EditDecisionList {
  /** All edit decisions, ordered by startTime */
  decisions: EditDecision[];
  /** Absolute path to the source video file */
  sourceVideo: string;
  /** Absolute path for the output video file */
  outputPath: string;
  /** Detected webcam region from face detection (optional) */
  webcamRegion?: WebcamRegion;
  /** Additional metadata for the edit session */
  metadata?: EditMetadata;
}

/**
 * Optional metadata attached to an EDL.
 */
export interface EditMetadata {
  /** Human-readable description of this edit */
  description?: string;
  /** When this EDL was created */
  createdAt?: Date;
  /** Agent or user that created this EDL */
  createdBy?: string;
  /** Version of the EDL schema */
  schemaVersion?: string;
  /** Source video duration in seconds */
  sourceDuration?: number;
  /** Source video dimensions */
  sourceWidth?: number;
  sourceHeight?: number;
  /** Target output dimensions (if different from source) */
  outputWidth?: number;
  outputHeight?: number;
  /** Target output frame rate */
  outputFps?: number;
  /** Target aspect ratio — controls how split_layout behaves */
  targetAspectRatio?: '16:9' | '9:16' | '1:1' | '4:5';
  /** Absolute path to the font file used for text overlays */
  fontPath?: string;
}

// ============================================================================
// EDL COMPILATION RESULT
// ============================================================================

/**
 * Result of compiling an EDL into FFmpeg commands.
 *
 * The compiler analyzes the EDL and produces optimized FFmpeg
 * filter graphs that apply all edits in minimal passes.
 */
export interface EDLCompilationResult {
  /** Whether compilation succeeded */
  success: boolean;
  /** FFmpeg filter_complex string (if applicable) */
  filterComplex?: string;
  /** Complete FFmpeg command arguments */
  ffmpegArgs?: string[];
  /** Number of encoding passes required */
  passCount: number;
  /** Estimated output duration in seconds */
  estimatedDuration?: number;
  /** Warnings generated during compilation */
  warnings: string[];
  /** Error message if compilation failed */
  error?: string;
}

// ============================================================================
// EDL VALIDATION
// ============================================================================

/**
 * Result of validating an EDL for correctness.
 */
export interface EDLValidationResult {
  /** Whether the EDL is valid */
  valid: boolean;
  /** Validation errors (if any) */
  errors: EDLValidationError[];
  /** Non-fatal warnings */
  warnings: EDLValidationWarning[];
}

/**
 * A validation error in an EDL.
 */
export interface EDLValidationError {
  /** ID of the problematic decision (or 'edl' for top-level errors) */
  decisionId: string;
  /** Error code for programmatic handling */
  code: string;
  /** Human-readable error message */
  message: string;
}

/**
 * A validation warning in an EDL.
 */
export interface EDLValidationWarning {
  /** ID of the problematic decision (or 'edl' for top-level warnings) */
  decisionId: string;
  /** Warning code for programmatic handling */
  code: string;
  /** Human-readable warning message */
  message: string;
}

// ============================================================================
// HELPER TYPES
// ============================================================================

/**
 * Type guard to check if a decision is a layout decision.
 */
export function isLayoutDecision(decision: EditDecision): decision is LayoutDecision {
  return decision.type === 'layout';
}

/**
 * Type guard to check if a decision is a transition decision.
 */
export function isTransitionDecision(decision: EditDecision): decision is TransitionDecision {
  return decision.type === 'transition';
}

/**
 * Type guard to check if a decision is an effect decision.
 */
export function isEffectDecision(decision: EditDecision): decision is EffectDecision {
  return decision.type === 'effect';
}

/**
 * Default parameters for layout types.
 */
export const DEFAULT_LAYOUT_PARAMS: Record<LayoutType, Record<string, unknown>> = {
  only_webcam: { scale: 1.0 },
  only_screen: {},
  split_layout: { screenPercent: 65, webcamPosition: 'bottom-right' },
  zoom_webcam: { scale: 1.5 },
  zoom_screen: { scale: 1.5 },
};

/**
 * Default parameters for transition types.
 */
export const DEFAULT_TRANSITION_PARAMS: Record<TransitionType, Record<string, unknown>> = {
  fade: { duration: 0.5 },
  swipe: { direction: 'left', duration: 0.3 },
  zoom_transition: { scale: 1.5, duration: 0.5, blur: true },
  cut: {},
};

/**
 * Default parameters for effect types.
 */
export const DEFAULT_EFFECT_PARAMS: Record<EffectType, Record<string, unknown>> = {
  text_overlay: { position: 'bottom-center', fontSize: 48, color: '#FFFFFF' },
  highlight_region: { color: '#FF0000', borderWidth: 3, dimOutside: false },
  slow_motion: { speed: 0.5, preservePitch: true },
  b_roll: { displayMode: 'fullscreen' },
  fade_to_black: { duration: 1.0 },
};
