import type { ToolWithHandler, LLMSession } from '../L3-services/llm/providerFactory.js'
import type {
  AnswerProvider,
  CreateIdeaInput,
  Idea,
  InterviewInsights,
  InterviewResult,
  QAPair,
  QuestionContext,
} from '../L0-pure/types/index.js'
import { BaseAgent } from './BaseAgent.js'
import { interviewEmitter } from '../L1-infra/progress/interviewEmitter.js'
import logger from '../L1-infra/logger/configLogger.js'

const SYSTEM_PROMPT = `You are a Socratic interview coach helping a content creator sharpen their video idea. Ask ONE short question at a time (1 sentence max).

## Rules
- Every question must be a SINGLE sentence. No multi-part questions. No preamble. No encouragement filler.
- Build on the previous answer — reference what the user said.
- Push on weak spots: vague audience, generic hooks, surface-level talking points.
- If the user responds with "/end", call end_interview immediately.

## Focus (pick one per question)
- Problem clarity — what specific pain does this solve?
- Audience — who exactly, what skill level?
- Key takeaway — what's the ONE thing to remember?
- Hook — would you click this? Be specific.
- Talking points — substantive or surface-level?
- Trend relevance — why now?

## Tools
- ask_question: EVERY question goes through this tool. Include a 1-sentence rationale and the target field.
- update_field: When the conversation reveals a better value for a field, DIRECTLY SET the new value. For scalar fields (hook, audience, keyTakeaway, trendContext), provide the complete replacement text. For array fields (talkingPoints), provide the FULL updated list — not just the new item. Write the actual content, not a description of the change.
- end_interview: After 5–10 productive questions, wrap up with a brief summary.
- NEVER output text outside of tool calls.`

export class InterviewAgent extends BaseAgent {
  private answerProvider: AnswerProvider | null = null
  private transcript: QAPair[] = []
  private insights: InterviewInsights = {}
  private questionNumber = 0
  private ended = false
  private idea: Idea | null = null

  constructor(model?: string) {
    super('InterviewAgent', SYSTEM_PROMPT, undefined, model)
  }

  protected getTimeoutMs(): number {
    // Interactive sessions wait for human input inside tool handlers —
    // return 0 to disable the timeout entirely and use send() + session.idle
    return 0
  }

  protected resetForRetry(): void {
    this.transcript = []
    this.insights = {}
    this.questionNumber = 0
    this.ended = false
  }

  protected getTools(): ToolWithHandler[] {
    return [
      {
        name: 'ask_question',
        description:
          'Ask the user a single Socratic question to explore and develop the idea. ' +
          'This is the primary way you communicate — every question MUST go through this tool.',
        parameters: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'The question to ask the user. Must be a single, focused question.',
            },
            rationale: {
              type: 'string',
              description: 'Why you are asking this question — what gap or opportunity it explores.',
            },
            targetField: {
              type: 'string',
              description: 'Which idea field this question explores (e.g. hook, audience, keyTakeaway, talkingPoints, trendContext).',
              enum: ['topic', 'hook', 'audience', 'keyTakeaway', 'talkingPoints', 'platforms', 'tags', 'publishBy', 'trendContext'],
            },
          },
          required: ['question', 'rationale'],
          additionalProperties: false,
        },
        handler: async (args) => this.handleToolCall('ask_question', args),
      },
      {
        name: 'update_field',
        description:
          'Directly update an idea field with new content discovered during the interview. ' +
          'For scalar fields, provide the complete replacement text. ' +
          'For talkingPoints, provide the FULL updated list (all points, not just new ones).',
        parameters: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'Which idea field to update.',
              enum: ['topic', 'hook', 'audience', 'keyTakeaway', 'talkingPoints', 'tags', 'trendContext'],
            },
            value: {
              type: 'string',
              description: 'The new value for scalar fields (hook, audience, keyTakeaway, trendContext, topic).',
            },
            values: {
              type: 'array',
              items: { type: 'string' },
              description: 'The full updated list for array fields (talkingPoints, tags). Include ALL items, not just new ones.',
            },
          },
          required: ['field'],
          additionalProperties: false,
        },
        handler: async (args) => this.handleToolCall('update_field', args),
      },
      {
        name: 'end_interview',
        description:
          'Signal that the interview is complete. Use when you have gathered sufficient insights ' +
          '(typically after 5–10 questions) to meaningfully improve the idea.',
        parameters: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'A summary of what was learned and how the idea has been refined.',
            },
          },
          required: ['summary'],
          additionalProperties: false,
        },
        handler: async (args) => this.handleToolCall('end_interview', args),
      },
    ]
  }

  protected async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'ask_question': return this.handleAskQuestion(args)
      case 'update_field': return this.handleUpdateField(args)
      case 'end_interview': return this.handleEndInterview(args)
      default: return { error: `Unknown tool: ${toolName}` }
    }
  }

  private async handleAskQuestion(args: Record<string, unknown>): Promise<string> {
    const question = String(args.question ?? '')
    const rationale = String(args.rationale ?? '')
    const targetField = args.targetField as keyof CreateIdeaInput | undefined

    this.questionNumber++

    const context: QuestionContext = {
      rationale,
      targetField,
      questionNumber: this.questionNumber,
    }

    interviewEmitter.emit({
      event: 'question:asked',
      question,
      context,
      timestamp: new Date().toISOString(),
    })

    logger.info(`[InterviewAgent] Q${this.questionNumber}: ${question}`)

    return this.waitForAnswer(question, context)
  }

  private handleUpdateField(args: Record<string, unknown>): { updated: true; field: string } {
    const field = String(args.field ?? '') as keyof CreateIdeaInput

    // Array fields use 'values', scalar fields use 'value'
    if (field === 'talkingPoints' || field === 'tags') {
      const values = args.values as string[] | undefined
      if (values && values.length > 0) {
        (this.insights as Record<string, unknown>)[field] = values
      }
    } else {
      const value = String(args.value ?? '')
      if (value) {
        (this.insights as Record<string, unknown>)[field] = value
      }
    }

    const displayValue = field === 'talkingPoints' || field === 'tags'
      ? `[${((args.values as string[]) ?? []).length} items]`
      : String(args.value ?? '').slice(0, 60)

    interviewEmitter.emit({
      event: 'insight:discovered',
      insight: displayValue,
      field,
      timestamp: new Date().toISOString(),
    })

    logger.info(`[InterviewAgent] Updated [${field}]: ${displayValue}`)

    return { updated: true, field }
  }

  private handleEndInterview(args: Record<string, unknown>): { ended: true; summary: string } {
    const summary = String(args.summary ?? '')
    this.ended = true

    logger.info(`[InterviewAgent] Interview ended: ${summary}`)

    return { ended: true, summary }
  }

  private async waitForAnswer(question: string, context: QuestionContext): Promise<string> {
    if (!this.answerProvider) {
      throw new Error('No answer provider configured — cannot ask questions')
    }

    const askedAt = new Date().toISOString()
    const answer = await this.answerProvider(question, context)
    const answeredAt = new Date().toISOString()

    const pair: QAPair = {
      question,
      answer,
      askedAt,
      answeredAt,
      questionNumber: context.questionNumber,
    }
    this.transcript.push(pair)

    interviewEmitter.emit({
      event: 'answer:received',
      questionNumber: context.questionNumber,
      answer,
      timestamp: new Date().toISOString(),
    })

    return answer
  }

  /**
   * Run a Socratic interview session for the given idea.
   *
   * The agent uses `ask_question` tool calls to present questions one at a time.
   * Each question is routed through the `answerProvider` callback, which the caller
   * implements to show the question to the user and collect their response.
   */
  async runInterview(idea: Idea, answerProvider: AnswerProvider): Promise<InterviewResult> {
    this.idea = idea
    this.answerProvider = answerProvider
    this.transcript = []
    this.insights = {}
    this.questionNumber = 0
    this.ended = false

    const startTime = Date.now()

    interviewEmitter.emit({
      event: 'interview:start',
      ideaNumber: idea.issueNumber,
      mode: 'interview',
      ideaTopic: idea.topic,
      timestamp: new Date().toISOString(),
    })

    const contextMessage = this.buildIdeaContext(idea)

    try {
      await this.run(contextMessage)

      const result: InterviewResult = {
        ideaNumber: idea.issueNumber,
        transcript: this.transcript,
        insights: this.insights,
        updatedFields: this.getUpdatedFields(),
        durationMs: Date.now() - startTime,
        endedBy: this.ended ? 'agent' : 'user',
      }

      interviewEmitter.emit({
        event: 'interview:complete',
        result,
        timestamp: new Date().toISOString(),
      })

      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      interviewEmitter.emit({
        event: 'interview:error',
        error: message,
        timestamp: new Date().toISOString(),
      })
      throw error
    }
  }

  private buildIdeaContext(idea: Idea): string {
    const talkingPoints = idea.talkingPoints.length > 0
      ? idea.talkingPoints.map(p => `- ${p}`).join('\n')
      : '- (none yet)'

    return [
      'Here is the idea to explore through Socratic questioning:',
      '',
      `**Topic:** ${idea.topic}`,
      `**Hook:** ${idea.hook}`,
      `**Audience:** ${idea.audience}`,
      `**Key Takeaway:** ${idea.keyTakeaway}`,
      '**Talking Points:**',
      talkingPoints,
      `**Publish By:** ${idea.publishBy}`,
      `**Trend Context:** ${idea.trendContext ?? 'Not specified'}`,
      '',
      'Begin by asking your first Socratic question to explore and develop this idea.',
    ].join('\n')
  }

  private getUpdatedFields(): (keyof CreateIdeaInput)[] {
    const fields: (keyof CreateIdeaInput)[] = []
    if (this.insights.talkingPoints !== undefined) fields.push('talkingPoints')
    if (this.insights.keyTakeaway !== undefined) fields.push('keyTakeaway')
    if (this.insights.hook !== undefined) fields.push('hook')
    if (this.insights.audience !== undefined) fields.push('audience')
    if (this.insights.trendContext !== undefined) fields.push('trendContext')
    if (this.insights.tags !== undefined) fields.push('tags')
    return fields
  }

  protected setupEventHandlers(session: LLMSession): void {
    session.on('delta', () => {
      // Agent uses tools for all interaction — no streaming display needed
    })
    session.on('tool_start', (event) => {
      const toolName = (event.data as Record<string, unknown>)?.name as string ?? 'unknown'
      if (toolName !== 'ask_question') {
        interviewEmitter.emit({
          event: 'tool:start',
          toolName,
          timestamp: new Date().toISOString(),
        })
      }
    })
    session.on('tool_end', (event) => {
      const toolName = (event.data as Record<string, unknown>)?.name as string ?? 'unknown'
      if (toolName !== 'ask_question') {
        interviewEmitter.emit({
          event: 'tool:end',
          toolName,
          durationMs: 0,
          timestamp: new Date().toISOString(),
        })
      }
    })
    session.on('error', (event) => {
      logger.error(`[InterviewAgent] error: ${JSON.stringify(event.data)}`)
    })
  }
}
