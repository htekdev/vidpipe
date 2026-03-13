/**
 * L6 pipeline bridge for ideation.
 * Exposes generateIdeas to L7-app via the L5 → L4 chain.
 */
import { generateIdeas as _generateIdeas } from '../L5-assets/pipelineServices.js'

export function generateIdeas(...args: Parameters<typeof _generateIdeas>): ReturnType<typeof _generateIdeas> {
  return _generateIdeas(...args)
}
