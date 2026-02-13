/**
 * Semantic effect tools for ProducerAgent.
 *
 * These tools provide a high-level interface for adding effects to videos.
 * Each tool adds an EffectDecision to the accumulator and returns a
 * confirmation message suitable for agent output.
 */

import type { EdlAccumulator } from './accumulator.js';
import type { TextPosition } from '../../types/edl.js';

/**
 * Add a text overlay to the video.
 *
 * @param accumulator - EDL accumulator to add the decision to
 * @param startTime - When the text appears (seconds)
 * @param endTime - When the text disappears (seconds)
 * @param text - The text to display
 * @param position - Where to position the text (default: 'bottom')
 * @returns Confirmation message
 */
export function text_overlay(
  accumulator: EdlAccumulator,
  startTime: number,
  endTime: number,
  text: string,
  position: 'top' | 'bottom' | 'center' = 'bottom',
): string {
  // Map simplified position to full TextPosition
  const positionMap: Record<'top' | 'bottom' | 'center', TextPosition> = {
    top: 'top-center',
    bottom: 'bottom-center',
    center: 'center',
  };

  accumulator.add({
    type: 'effect',
    tool: 'text_overlay',
    startTime,
    endTime,
    params: {
      text,
      position: positionMap[position],
    },
  });

  return `Added text overlay "${text}" from ${startTime}s to ${endTime}s at ${position}`;
}

/**
 * Draw a highlight box around a region of the video.
 *
 * @param accumulator - EDL accumulator to add the decision to
 * @param startTime - When the highlight appears (seconds)
 * @param endTime - When the highlight disappears (seconds)
 * @param x - X coordinate of the highlight box (pixels from left)
 * @param y - Y coordinate of the highlight box (pixels from top)
 * @param width - Width of the highlight box in pixels
 * @param height - Height of the highlight box in pixels
 * @param color - Border color (default: 'yellow')
 * @returns Confirmation message
 */
export function highlight_region(
  accumulator: EdlAccumulator,
  startTime: number,
  endTime: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string = 'yellow',
): string {
  accumulator.add({
    type: 'effect',
    tool: 'highlight_region',
    startTime,
    endTime,
    params: {
      x,
      y,
      width,
      height,
      color,
    },
  });

  return `Added highlight box at (${x}, ${y}) ${width}x${height} from ${startTime}s to ${endTime}s with color ${color}`;
}

/**
 * Apply speed adjustment (slow motion or fast forward).
 *
 * @param accumulator - EDL accumulator to add the decision to
 * @param startTime - When the speed change begins (seconds)
 * @param endTime - When the speed change ends (seconds)
 * @param speed - Speed multiplier (0.5 = half speed, 2.0 = double speed)
 * @returns Confirmation message
 */
export function slow_motion(
  accumulator: EdlAccumulator,
  startTime: number,
  endTime: number,
  speed: number,
): string {
  accumulator.add({
    type: 'effect',
    tool: 'slow_motion',
    startTime,
    endTime,
    params: {
      speed,
      preservePitch: speed >= 0.5,
    },
  });

  const speedDescription = speed < 1 ? `${speed}x slow motion` : `${speed}x speed`;
  return `Added ${speedDescription} from ${startTime}s to ${endTime}s`;
}
