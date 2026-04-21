/**
 * L6 pipeline bridge for ideation.
 * Exposes generateIdeas and startInterview to L7-app via the L5 → L4 chain.
 */
import { generateIdeas as _generateIdeas, createInterviewAgent as _createInterviewAgent, createAgendaAgent as _createAgendaAgent, createIdeaDiscoveryAgent as _createIdeaDiscoveryAgent } from '../L5-assets/pipelineServices.js'
import type { AnswerProvider, Idea, InterviewResult, AgendaResult } from '../L0-pure/types/index.js'
import type { DiscoverIdeasInput, IdeaDiscoveryResult } from '../L4-agents/IdeaDiscoveryAgent.js'
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

/**
 * Generate a structured recording agenda from multiple ideas.
 * Creates an AgendaAgent, runs it, and returns the agenda result.
 */
export async function generateAgenda(ideas: readonly Idea[]): Promise<AgendaResult> {
  const agent = _createAgendaAgent(ideas)
  try {
    return await agent.generateAgenda(ideas)
  } finally {
    await agent.destroy()
  }
}

/**
 * Run idea discovery on clips — match to existing ideas or create new ones.
 * Standalone entry point for retroactive discovery on already-processed videos.
 */
export async function discoverIdeas(input: DiscoverIdeasInput): Promise<IdeaDiscoveryResult> {
  const agent = _createIdeaDiscoveryAgent(input)
  try {
    return await agent.discover()
  } finally {
    await agent.destroy()
  }
}

export type { DiscoverIdeasInput, IdeaDiscoveryResult }
