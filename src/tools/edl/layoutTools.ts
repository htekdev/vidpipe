/**
 * Semantic layout tools for ProducerAgent.
 *
 * These tools provide a high-level API for setting video layouts.
 * Each tool adds a LayoutDecision to the EdlAccumulator.
 */

import type { EdlAccumulator } from './accumulator.js';
import type {
  OnlyWebcamParams,
  OnlyScreenParams,
  SplitLayoutParams,
  ZoomWebcamParams,
  ZoomScreenParams,
} from '../../types/edl.js';

/**
 * Show only webcam feed, scaled to fill the full frame.
 * Useful for intro/outro segments or personal commentary.
 *
 * @param accumulator - EDL accumulator to add the decision to
 * @param startTime - When this layout begins (seconds)
 * @param endTime - When this layout ends (seconds)
 * @returns Confirmation message
 */
export function only_webcam(
  accumulator: EdlAccumulator,
  startTime: number,
  endTime: number,
): string {
  const params: OnlyWebcamParams = {};
  accumulator.add({
    type: 'layout',
    tool: 'only_webcam',
    startTime,
    endTime,
    params,
  });
  return `Added only_webcam layout from ${startTime}s to ${endTime}s`;
}

/**
 * Show only screen content, scaled to fill the full frame.
 * Useful for detailed code walkthroughs or demos.
 *
 * @param accumulator - EDL accumulator to add the decision to
 * @param startTime - When this layout begins (seconds)
 * @param endTime - When this layout ends (seconds)
 * @returns Confirmation message
 */
export function only_screen(
  accumulator: EdlAccumulator,
  startTime: number,
  endTime: number,
): string {
  const params: OnlyScreenParams = {};
  accumulator.add({
    type: 'layout',
    tool: 'only_screen',
    startTime,
    endTime,
    params,
  });
  return `Added only_screen layout from ${startTime}s to ${endTime}s`;
}

/**
 * Standard split layout with screen content on top and webcam below.
 * This is the default layout for most coding/tutorial content.
 *
 * @param accumulator - EDL accumulator to add the decision to
 * @param startTime - When this layout begins (seconds)
 * @param endTime - When this layout ends (seconds)
 * @returns Confirmation message
 */
export function split_layout(
  accumulator: EdlAccumulator,
  startTime: number,
  endTime: number,
): string {
  const params: SplitLayoutParams = {
    screenPercent: 65,
    webcamPosition: 'bottom-right',
  };
  accumulator.add({
    type: 'layout',
    tool: 'split_layout',
    startTime,
    endTime,
    params,
  });
  return `Added split_layout from ${startTime}s to ${endTime}s (screen 65%, webcam 35%)`;
}

/**
 * Zoom in on the webcam feed, cropping edges.
 * Useful for emphasis during personal moments or reactions.
 *
 * @param accumulator - EDL accumulator to add the decision to
 * @param startTime - When this layout begins (seconds)
 * @param endTime - When this layout ends (seconds)
 * @param scale - Scale factor for zoom (default: 1.2)
 * @returns Confirmation message
 */
export function zoom_webcam(
  accumulator: EdlAccumulator,
  startTime: number,
  endTime: number,
  scale: number = 1.2,
): string {
  const params: ZoomWebcamParams = { scale };
  accumulator.add({
    type: 'layout',
    tool: 'zoom_webcam',
    startTime,
    endTime,
    params,
  });
  return `Added zoom_webcam layout from ${startTime}s to ${endTime}s (scale: ${scale}x)`;
}

/**
 * Zoom in on a specific region of the screen capture.
 * Useful for highlighting code, UI elements, or terminal output.
 *
 * @param accumulator - EDL accumulator to add the decision to
 * @param startTime - When this layout begins (seconds)
 * @param endTime - When this layout ends (seconds)
 * @param region - Optional target region to zoom into (normalized 0-1 coordinates)
 * @returns Confirmation message
 */
export function zoom_screen(
  accumulator: EdlAccumulator,
  startTime: number,
  endTime: number,
  region?: { x: number; y: number; width: number; height: number },
): string {
  const params: ZoomScreenParams = {
    scale: 1.5,
    region,
  };
  accumulator.add({
    type: 'layout',
    tool: 'zoom_screen',
    startTime,
    endTime,
    params,
  });
  const regionDesc = region
    ? ` on region (${region.x}, ${region.y}, ${region.width}x${region.height})`
    : '';
  return `Added zoom_screen layout from ${startTime}s to ${endTime}s${regionDesc}`;
}
