/**
 * L4 bridge for pipeline infrastructure services.
 *
 * Wraps L3 services used by the pipeline orchestrator (L6) via L5 loaders,
 * maintaining strict layer hierarchy: L6 → L5 → L4 → L3.
 */

import { costTracker as _costTracker } from '../L3-services/costTracking/costTracker.js'
import { markPending as _markPending, markProcessing as _markProcessing, markCompleted as _markCompleted, markFailed as _markFailed } from '../L3-services/processingState/processingState.js'
import { commitAndPush as _commitAndPush } from '../L3-services/gitOperations/gitOperations.js'
import { buildPublishQueue as _buildPublishQueue } from '../L3-services/queueBuilder/queueBuilder.js'

// Re-export types (exempt from layer rules)
export type { CostReport } from '../L3-services/costTracking/costTracker.js'
export type { QueueBuildResult } from '../L3-services/queueBuilder/queueBuilder.js'

// Cost tracking — proxy object wrapping L3 singleton
export const costTracker = {
  reset: (...args: Parameters<typeof _costTracker.reset>) => _costTracker.reset(...args),
  setStage: (...args: Parameters<typeof _costTracker.setStage>) => _costTracker.setStage(...args),
  getReport: (...args: Parameters<typeof _costTracker.getReport>) => _costTracker.getReport(...args),
  formatReport: (...args: Parameters<typeof _costTracker.formatReport>) => _costTracker.formatReport(...args),
  recordServiceUsage: (...args: Parameters<typeof _costTracker.recordServiceUsage>) => _costTracker.recordServiceUsage(...args),
} as const

// Processing state
export function markPending(...args: Parameters<typeof _markPending>): ReturnType<typeof _markPending> {
  return _markPending(...args)
}

export function markProcessing(...args: Parameters<typeof _markProcessing>): ReturnType<typeof _markProcessing> {
  return _markProcessing(...args)
}

export function markCompleted(...args: Parameters<typeof _markCompleted>): ReturnType<typeof _markCompleted> {
  return _markCompleted(...args)
}

export function markFailed(...args: Parameters<typeof _markFailed>): ReturnType<typeof _markFailed> {
  return _markFailed(...args)
}

// Git operations
export function commitAndPush(...args: Parameters<typeof _commitAndPush>): ReturnType<typeof _commitAndPush> {
  return _commitAndPush(...args)
}

// Queue builder
export function buildPublishQueue(...args: Parameters<typeof _buildPublishQueue>): ReturnType<typeof _buildPublishQueue> {
  return _buildPublishQueue(...args)
}
