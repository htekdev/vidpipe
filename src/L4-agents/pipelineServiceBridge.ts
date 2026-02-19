/**
 * L4 bridge for pipeline infrastructure services.
 *
 * Re-exports L3 services used by the pipeline orchestrator (L6) via L5 loaders,
 * maintaining strict layer hierarchy: L6 → L5 → L4 → L3.
 */

// Cost tracking
export { costTracker } from '../L3-services/costTracking/costTracker.js'
export type { CostReport } from '../L3-services/costTracking/costTracker.js'

// Processing state
export { markPending, markProcessing, markCompleted, markFailed } from '../L3-services/processingState/processingState.js'

// Git operations
export { commitAndPush } from '../L3-services/gitOperations/gitOperations.js'

// Queue builder
export { buildPublishQueue } from '../L3-services/queueBuilder/queueBuilder.js'
export type { QueueBuildResult } from '../L3-services/queueBuilder/queueBuilder.js'
