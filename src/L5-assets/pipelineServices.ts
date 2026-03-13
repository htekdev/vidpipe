/**
 * L5 wrappers for pipeline infrastructure services from L4.
 * Maintains strict layer hierarchy: L6 → L5 → L4 → L3.
 */

import {
  costTracker as _costTracker,
  startRun as _startRun,
  completeRun as _completeRun,
  failRun as _failRun,
  markPending as _markPending,
  markProcessing as _markProcessing,
  markCompleted as _markCompleted,
  markFailed as _markFailed,
  buildPublishQueue as _buildPublishQueue,
  commitAndPush as _commitAndPush,
} from '../L4-agents/pipelineServiceBridge.js'
import { ScheduleAgent as _ScheduleAgent } from '../L4-agents/ScheduleAgent.js'

// Re-export types (exempt from layer rules)
export type { CostReport, QueueBuildResult } from '../L4-agents/pipelineServiceBridge.js'

// Cost tracking — proxy delegating to L4 bridge
export const costTracker = {
  reset: (...args: Parameters<typeof _costTracker.reset>) => _costTracker.reset(...args),
  setRunId: (...args: Parameters<typeof _costTracker.setRunId>) => _costTracker.setRunId(...args),
  setStage: (...args: Parameters<typeof _costTracker.setStage>) => _costTracker.setStage(...args),
  getReport: (...args: Parameters<typeof _costTracker.getReport>) => _costTracker.getReport(...args),
  formatReport: (...args: Parameters<typeof _costTracker.formatReport>) => _costTracker.formatReport(...args),
  recordServiceUsage: (...args: Parameters<typeof _costTracker.recordServiceUsage>) => _costTracker.recordServiceUsage(...args),
} as const

// Pipeline run audit trail
export function startRun(...args: Parameters<typeof _startRun>): ReturnType<typeof _startRun> {
  return _startRun(...args)
}

export function completeRun(...args: Parameters<typeof _completeRun>): ReturnType<typeof _completeRun> {
  return _completeRun(...args)
}

export function failRun(...args: Parameters<typeof _failRun>): ReturnType<typeof _failRun> {
  return _failRun(...args)
}

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

// Queue builder
export function buildPublishQueue(...args: Parameters<typeof _buildPublishQueue>): ReturnType<typeof _buildPublishQueue> {
  return _buildPublishQueue(...args)
}

// Git operations
export function commitAndPush(...args: Parameters<typeof _commitAndPush>): ReturnType<typeof _commitAndPush> {
  return _commitAndPush(...args)
}

// Schedule agent factory
export function createScheduleAgent(
  ...args: ConstructorParameters<typeof _ScheduleAgent>
): InstanceType<typeof _ScheduleAgent> {
  return new _ScheduleAgent(...args)
}
