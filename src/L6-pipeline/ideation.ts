/**
 * L6 pipeline bridge for ideation.
 * Exposes generateIdeas and enrichIdeaInput to L7-app via the L5 → L4 chain.
 */
import { generateIdeas as _generateIdeas, enrichIdeaInput as _enrichIdeaInput } from '../L5-assets/pipelineServices.js'

export function generateIdeas(...args: Parameters<typeof _generateIdeas>): ReturnType<typeof _generateIdeas> {
  return _generateIdeas(...args)
}

export function enrichIdeaInput(...args: Parameters<typeof _enrichIdeaInput>): ReturnType<typeof _enrichIdeaInput> {
  return _enrichIdeaInput(...args)
}
