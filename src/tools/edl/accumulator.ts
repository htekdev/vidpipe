/**
 * EDL Accumulator for collecting edit decisions during agent execution.
 *
 * The accumulator provides a convenient way for agents to build up an EDL
 * incrementally as they analyze video content and make editing decisions.
 * It handles ID generation, sorting, validation, and EDL construction.
 */

import type {
  EditDecision,
  EditDecisionList,
  WebcamRegion,
} from '../../types/edl.js';

/**
 * Accumulates edit decisions during agent execution.
 *
 * @example
 * ```typescript
 * const acc = createAccumulator();
 *
 * // Add layout decisions as agent analyzes video
 * acc.add({ type: 'layout', tool: 'split_layout', startTime: 0, endTime: 30, params: {} });
 * acc.add({ type: 'layout', tool: 'zoom_webcam', startTime: 30, endTime: 45, params: { scale: 1.5 } });
 *
 * // Validate and build EDL
 * const { valid, errors } = acc.validate();
 * if (valid) {
 *   const edl = acc.toEdl('/path/to/video.mp4', '/path/to/output.mp4');
 * }
 * ```
 */
export class EdlAccumulator {
  private decisions: EditDecision[] = [];
  private nextId: number = 1;

  /**
   * Add an edit decision to the accumulator.
   * ID is auto-generated in the format "{type}-{number}".
   *
   * @param decision - The decision to add (without id)
   * @returns The generated ID
   */
  add(decision: Omit<EditDecision, 'id'>): string {
    const id = `${decision.type}-${this.nextId++}`;
    this.decisions.push({ ...decision, id });
    return id;
  }

  /**
   * Get all decisions sorted by startTime.
   *
   * @returns Array of decisions in chronological order
   */
  getDecisions(): EditDecision[] {
    return [...this.decisions].sort((a, b) => a.startTime - b.startTime);
  }

  /**
   * Build the final EDL from accumulated decisions.
   *
   * @param sourceVideo - Path to the source video file
   * @param outputPath - Path for the output video file
   * @param webcamRegion - Optional detected webcam region
   * @returns Complete EditDecisionList
   */
  toEdl(
    sourceVideo: string,
    outputPath: string,
    webcamRegion?: WebcamRegion,
  ): EditDecisionList {
    return {
      decisions: this.getDecisions(),
      sourceVideo,
      outputPath,
      webcamRegion,
    };
  }

  /**
   * Clear all accumulated decisions.
   */
  clear(): void {
    this.decisions = [];
    this.nextId = 1;
  }

  /**
   * Validate accumulated decisions for consistency.
   *
   * Checks:
   * - Layout decisions cannot overlap (only one layout active at a time)
   * - Transitions must occur at layout boundaries
   * - Effects can overlap with layouts (this is allowed)
   *
   * @returns Validation result with any errors found
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const sorted = this.getDecisions();

    // Separate by type
    const layouts = sorted.filter((d) => d.type === 'layout');
    const transitions = sorted.filter((d) => d.type === 'transition');

    // Check layout overlaps
    for (let i = 0; i < layouts.length; i++) {
      const current = layouts[i];
      for (let j = i + 1; j < layouts.length; j++) {
        const next = layouts[j];
        if (this.decisionsOverlap(current, next)) {
          errors.push(
            `Layout decisions overlap: ${current.id} (${current.startTime}-${current.endTime ?? 'end'}) ` +
              `and ${next.id} (${next.startTime}-${next.endTime ?? 'end'})`,
          );
        }
      }
    }

    // Check transitions occur at layout boundaries
    for (const transition of transitions) {
      const atBoundary = layouts.some((layout) => {
        // Transition should occur at the end of a layout
        if (layout.endTime !== undefined) {
          return Math.abs(layout.endTime - transition.startTime) < 0.01;
        }
        // Or at the start of a layout
        return Math.abs(layout.startTime - transition.startTime) < 0.01;
      });

      if (!atBoundary && layouts.length > 0) {
        errors.push(
          `Transition ${transition.id} at ${transition.startTime}s is not at a layout boundary`,
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if two decisions overlap in time.
   */
  private decisionsOverlap(a: EditDecision, b: EditDecision): boolean {
    // If either has no endTime, treat it as extending to infinity
    const aEnd = a.endTime ?? Infinity;
    const bEnd = b.endTime ?? Infinity;

    // Overlap exists if neither ends before the other starts
    return a.startTime < bEnd && b.startTime < aEnd;
  }
}

/**
 * Create a new EDL accumulator for an agent session.
 *
 * @returns Fresh EdlAccumulator instance
 */
export function createAccumulator(): EdlAccumulator {
  return new EdlAccumulator();
}

/**
 * Optimize an EDL by merging adjacent compatible decisions.
 *
 * This function:
 * - Merges adjacent layout decisions of the same type
 * - Removes redundant transitions (e.g., cuts between identical layouts)
 * - Combines overlapping effects of the same type
 *
 * @param edl - The EDL to optimize
 * @returns Optimized EDL with merged decisions
 */
export function optimizeEdl(edl: EditDecisionList): EditDecisionList {
  const decisions = [...edl.decisions].sort((a, b) => a.startTime - b.startTime);

  // Group by type for separate optimization
  const layouts = decisions.filter((d) => d.type === 'layout');
  const transitions = decisions.filter((d) => d.type === 'transition');
  const effects = decisions.filter((d) => d.type === 'effect');

  // Merge adjacent layouts of the same type
  const mergedLayouts = mergeAdjacentDecisions(layouts);

  // Remove transitions that are now inside a merged layout (no longer at a boundary)
  const filteredTransitions = transitions.filter((transition) => {
    // Check if transition time falls inside a merged layout (not at start/end)
    const insideLayout = mergedLayouts.some((l) => {
      const layoutEnd = l.endTime ?? Infinity;
      // Transition is inside if it's after start and before end (not at boundaries)
      return (
        transition.startTime > l.startTime + 0.01 &&
        transition.startTime < layoutEnd - 0.01
      );
    });

    // If transition is inside a merged layout, remove it
    if (insideLayout) return false;

    // Also check: transition between two identical adjacent layouts should be removed
    const layoutBefore = mergedLayouts.find(
      (l) => l.endTime !== undefined && Math.abs(l.endTime - transition.startTime) < 0.01,
    );
    const layoutAfter = mergedLayouts.find(
      (l) => Math.abs(l.startTime - transition.startTime) < 0.01,
    );

    // Keep transition if layouts are different or if we can't determine
    if (!layoutBefore || !layoutAfter) return true;
    return layoutBefore.tool !== layoutAfter.tool;
  });

  // Merge overlapping effects of the same type and tool
  const mergedEffects = mergeOverlappingEffects(effects);

  // Combine and sort all decisions
  const optimized = [...mergedLayouts, ...filteredTransitions, ...mergedEffects].sort(
    (a, b) => a.startTime - b.startTime,
  );

  return {
    ...edl,
    decisions: optimized,
  };
}

/**
 * Merge adjacent decisions of the same tool type.
 */
function mergeAdjacentDecisions(decisions: EditDecision[]): EditDecision[] {
  if (decisions.length === 0) return [];

  const merged: EditDecision[] = [];
  let current = { ...decisions[0] };

  for (let i = 1; i < decisions.length; i++) {
    const next = decisions[i];

    // Check if adjacent and same tool with compatible params
    const isAdjacent =
      current.endTime !== undefined && Math.abs(current.endTime - next.startTime) < 0.01;

    const sameToolAndParams =
      current.tool === next.tool && JSON.stringify(current.params) === JSON.stringify(next.params);

    if (isAdjacent && sameToolAndParams) {
      // Extend current decision
      current.endTime = next.endTime;
    } else {
      // Push current and start new
      merged.push(current);
      current = { ...next };
    }
  }

  merged.push(current);
  return merged;
}

/**
 * Merge overlapping effects of the same type.
 */
function mergeOverlappingEffects(effects: EditDecision[]): EditDecision[] {
  if (effects.length === 0) return [];

  // Group by tool type
  const byTool = new Map<string, EditDecision[]>();
  for (const effect of effects) {
    const key = effect.tool;
    if (!byTool.has(key)) {
      byTool.set(key, []);
    }
    byTool.get(key)!.push(effect);
  }

  const merged: EditDecision[] = [];

  for (const [, toolEffects] of byTool) {
    // Sort by start time
    const sorted = toolEffects.sort((a, b) => a.startTime - b.startTime);

    let current = { ...sorted[0] };

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      const currentEnd = current.endTime ?? Infinity;

      // Check if overlapping and same params
      if (
        next.startTime <= currentEnd &&
        JSON.stringify(current.params) === JSON.stringify(next.params)
      ) {
        // Extend current effect
        const nextEnd = next.endTime ?? Infinity;
        current.endTime = Math.max(currentEnd, nextEnd) === Infinity ? undefined : Math.max(currentEnd, nextEnd);
      } else {
        merged.push(current);
        current = { ...next };
      }
    }

    merged.push(current);
  }

  return merged;
}
