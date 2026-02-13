/**
 * Semantic transition tools for ProducerAgent.
 *
 * These tools provide a convenient API for adding transition decisions
 * to an EDL accumulator. Each tool adds a TransitionDecision and returns
 * a confirmation message.
 */

import type { EdlAccumulator } from './accumulator.js';
import type { SwipeDirection } from '../../types/edl.js';

/**
 * Add a crossfade transition at the specified timestamp.
 *
 * @param accumulator - The EDL accumulator to add the transition to
 * @param time - Timestamp in seconds where the fade should occur
 * @param duration - Duration of the fade in seconds (default: 0.5)
 * @returns Confirmation message
 */
export function fade(
  accumulator: EdlAccumulator,
  time: number,
  duration: number = 0.5
): string {
  accumulator.add({
    type: 'transition',
    tool: 'fade',
    startTime: time,
    params: { duration }
  });
  return `Added fade transition at ${time}s (${duration}s duration)`;
}

/**
 * Add a swipe transition at the specified timestamp.
 *
 * @param accumulator - The EDL accumulator to add the transition to
 * @param time - Timestamp in seconds where the swipe should occur
 * @param direction - Direction the new content enters from ('left'|'right'|'up'|'down')
 * @returns Confirmation message
 */
export function swipe(
  accumulator: EdlAccumulator,
  time: number,
  direction: SwipeDirection
): string {
  accumulator.add({
    type: 'transition',
    tool: 'swipe',
    startTime: time,
    params: { direction }
  });
  return `Added swipe transition at ${time}s (direction: ${direction})`;
}

/**
 * Add a zoom blur transition at the specified timestamp.
 *
 * @param accumulator - The EDL accumulator to add the transition to
 * @param time - Timestamp in seconds where the zoom transition should occur
 * @param duration - Duration of the transition in seconds (default: 0.5)
 * @returns Confirmation message
 */
export function zoom_transition(
  accumulator: EdlAccumulator,
  time: number,
  duration: number = 0.5
): string {
  accumulator.add({
    type: 'transition',
    tool: 'zoom_transition',
    startTime: time,
    params: { duration }
  });
  return `Added zoom transition at ${time}s (${duration}s duration)`;
}

/**
 * Add a hard cut (instant transition) at the specified timestamp.
 *
 * @param accumulator - The EDL accumulator to add the transition to
 * @param time - Timestamp in seconds where the cut should occur
 * @returns Confirmation message
 */
export function cut(
  accumulator: EdlAccumulator,
  time: number
): string {
  accumulator.add({
    type: 'transition',
    tool: 'cut',
    startTime: time,
    params: {}
  });
  return `Added hard cut at ${time}s`;
}
