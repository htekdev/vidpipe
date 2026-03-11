/** Wrapper for ScheduleAgent for L7 consumption via L6 → L5 → L4. */
import { createScheduleAgent as _createScheduleAgent } from '../L5-assets/pipelineServices.js'

export function createScheduleAgent(
  ...args: Parameters<typeof _createScheduleAgent>
): ReturnType<typeof _createScheduleAgent> {
  return _createScheduleAgent(...args)
}
