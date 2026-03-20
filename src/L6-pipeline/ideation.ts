/**
 * L6 pipeline bridge for ideation.
 * Exposes generateIdeas and startInterview to L7-app via the L5 → L4 chain.
 */
import { generateIdeas as _generateIdeas, createInterviewAgent as _createInterviewAgent } from '../L5-assets/pipelineServices.js'
import type { AnswerProvider, Idea, InterviewResult } from '../L0-pure/types/index.js'
import type { InterviewListener } from '../L1-infra/progress/interviewEmitter.js'
import { interviewEmitter } from '../L1-infra/progress/interviewEmitter.js'

export function generateIdeas(...args: Parameters<typeof _generateIdeas>): ReturnType<typeof _generateIdeas> {
  return _generateIdeas(...args)
}

/**
 * Start an interactive interview session for an idea.
 * Creates an InterviewAgent, registers event listeners, and runs the interview.
 */
export async function startInterview(
  idea: Idea,
  answerProvider: AnswerProvider,
  onEvent?: InterviewListener,
): Promise<InterviewResult> {
  if (onEvent) interviewEmitter.addListener(onEvent)
  const agent = _createInterviewAgent()
  try {
    return await agent.runInterview(idea, answerProvider)
  } finally {
    await agent.destroy()
    if (onEvent) interviewEmitter.removeListener(onEvent)
  }
}
