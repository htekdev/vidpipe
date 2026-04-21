import type {
  CreateIdeaInput,
  Idea,
  InterviewInsights,
  QAPair,
} from '../../L0-pure/types/index.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { getGitHubClient } from '../../L2-clients/github/githubClient.js'
import {
  getIdea,
  updateIdea,
} from '../ideaService/ideaService.js'

export async function loadAndValidateIdea(issueNumber: number): Promise<Idea> {
  const idea = await getIdea(issueNumber)
  if (!idea) {
    throw new Error(`Idea #${issueNumber} not found`)
  }
  if (idea.status !== 'draft') {
    throw new Error(
      `Idea #${issueNumber} has status "${idea.status}" — only draft ideas can be started`,
    )
  }
  return idea
}

export function formatTranscriptComment(transcript: QAPair[]): string {
  const now = new Date().toISOString()
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const lines: string[] = [
    '<!-- vidpipe:idea-comment -->',
    `<!-- {"type":"interview-transcript","savedAt":"${now}"} -->`,
    '',
    '## 🎙️ Interview Transcript',
    '',
    `**Questions asked:** ${transcript.length}`,
    `**Date:** ${date}`,
    '',
    '---',
  ]

  for (const qa of transcript) {
    lines.push('')
    lines.push(`### Q${qa.questionNumber}: ${qa.question}`)
    lines.push(`> ${qa.answer}`)
  }

  return lines.join('\n')
}

export async function saveTranscript(
  issueNumber: number,
  transcript: QAPair[],
): Promise<void> {
  const body = formatTranscriptComment(transcript)
  const client = getGitHubClient()
  await client.addComment(issueNumber, body)
  logger.info(`Saved interview transcript (${transcript.length} Q&A) to issue #${issueNumber}`)
}

export async function updateIdeaFromInsights(
  issueNumber: number,
  insights: InterviewInsights,
): Promise<void> {
  const updates: Partial<CreateIdeaInput> = {}
  const updatedFields: string[] = []

  // Scalar fields — direct replacement
  if (insights.hook !== undefined) {
    updates.hook = insights.hook
    updatedFields.push('hook')
  }
  if (insights.audience !== undefined) {
    updates.audience = insights.audience
    updatedFields.push('audience')
  }
  if (insights.keyTakeaway !== undefined) {
    updates.keyTakeaway = insights.keyTakeaway
    updatedFields.push('keyTakeaway')
  }
  if (insights.trendContext !== undefined) {
    updates.trendContext = insights.trendContext
    updatedFields.push('trendContext')
  }

  // Array fields — direct replacement (agent provides the full list)
  if (insights.talkingPoints !== undefined && insights.talkingPoints.length > 0) {
    updates.talkingPoints = insights.talkingPoints
    updatedFields.push('talkingPoints')
  }

  if (insights.tags !== undefined && insights.tags.length > 0) {
    updates.tags = insights.tags
    updatedFields.push('tags')
  }

  if (updatedFields.length === 0) {
    logger.info(`No fields to update for idea #${issueNumber} from insights`)
    return
  }

  await updateIdea(issueNumber, updates)
  logger.info(
    `Updated idea #${issueNumber} fields: ${updatedFields.join(', ')}`,
  )
}
