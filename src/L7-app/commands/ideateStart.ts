import type { AnswerProvider, IdeaStatus, InterviewEvent, InterviewResult, StartMode } from '../../L0-pure/types/index.js'
import { initConfig } from '../../L1-infra/config/environment.js'
import { setChatMode } from '../../L1-infra/logger/configLogger.js'
import { interviewEmitter } from '../../L1-infra/progress/interviewEmitter.js'
import { AltScreenChat } from '../../L1-infra/terminal/altScreenChat.js'
import { loadAndValidateIdea, saveTranscript, updateIdeaFromInsights } from '../../L3-services/interview/interviewService.js'
import { updateIdea } from '../../L3-services/ideaService/ideaService.js'
import { startInterview } from '../../L6-pipeline/ideation.js'

const VALID_MODES: readonly StartMode[] = ['interview'] as const

export interface IdeateStartOptions {
  mode?: string
  progress?: boolean
}

export async function runIdeateStart(issueNumber: string, options: IdeateStartOptions): Promise<void> {
  const parsed = Number.parseInt(issueNumber, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    console.error(`Invalid issue number: "${issueNumber}". Must be a positive integer.`)
    process.exit(1)
  }

  initConfig()

  const mode = (options.mode ?? 'interview') as StartMode
  if (!VALID_MODES.includes(mode)) {
    console.error(`Unknown mode: "${options.mode}". Valid modes: ${VALID_MODES.join(', ')}`)
    process.exit(1)
  }

  if (options.progress) {
    interviewEmitter.enable()
  }

  const idea = await loadAndValidateIdea(parsed)

  const chat = new AltScreenChat({
    title: `📝 Interview: ${idea.topic}`,
    subtitle: 'Type /end to finish the interview. Press Ctrl+C to save and quit.',
    inputPrompt: 'Your answer> ',
  })

  const answerProvider: AnswerProvider = async (question, context) => {
    // Show a focused question card — not a chat log
    chat.showQuestion(
      question,
      context.rationale,
      context.targetField ? String(context.targetField) : 'general',
      context.questionNumber,
    )
    const answer = await chat.promptInput()
    // Log internally for transcript (doesn't affect display)
    chat.addMessage('agent', question)
    chat.addMessage('user', answer)
    return answer
  }

  const handleEvent = (event: InterviewEvent): void => {
    switch (event.event) {
      case 'thinking:start':
        chat.setStatus('🤔 Thinking of next question...')
        break
      case 'thinking:end':
        chat.clearStatus()
        break
      case 'tool:start':
        chat.setStatus(`🔧 ${event.toolName}...`)
        break
      case 'tool:end':
        chat.clearStatus()
        break
      case 'insight:discovered':
        chat.showInsight(`${event.field}: ${event.insight}`)
        break
    }
  }

  setChatMode(true)
  chat.enter()
  chat.addMessage('system', `Starting interview for idea #${idea.issueNumber}: ${idea.topic}`)
  chat.addMessage('system', 'The agent will ask Socratic questions to help develop your idea.')

  try {
    const result = await startInterview(idea, answerProvider, handleEvent)
    await saveResults(result, chat, parsed)
  } catch (error) {
    if (error instanceof Error) {
      chat.addMessage('error', error.message)
    }
    throw error
  } finally {
    chat.destroy()
    setChatMode(false)
  }
}

async function saveResults(
  result: InterviewResult,
  chat: AltScreenChat,
  issueNumber: number,
): Promise<void> {
  // Show a summary card instead of invisible addMessage calls
  const durationSec = Math.round(result.durationMs / 1000)
  const fieldList = result.updatedFields.length > 0
    ? result.updatedFields.join(', ')
    : 'none'

  chat.showQuestion(
    `Interview ${result.endedBy === 'user' ? 'ended' : 'completed'} — ${result.transcript.length} questions in ${durationSec}s`,
    `Updated fields: ${fieldList}`,
    'summary',
    result.transcript.length,
  )

  if (result.transcript.length > 0) {
    chat.setStatus('💾 Saving transcript...')
    await saveTranscript(issueNumber, result.transcript)
  }

  if (result.insights && Object.keys(result.insights).length > 0) {
    chat.setStatus('💾 Updating idea fields...')
    await updateIdeaFromInsights(issueNumber, result.insights)
  }

  chat.clearStatus()
  chat.showInsight('✅ Saved! Mark this idea as ready? (yes/no)')

  const response = await chat.promptInput()
  if (response.toLowerCase().startsWith('y')) {
    await updateIdea(issueNumber, { status: 'ready' as IdeaStatus })
    chat.showInsight(`✅ Idea #${issueNumber} marked as ready`)
    // Brief pause so user can see the confirmation
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
}
