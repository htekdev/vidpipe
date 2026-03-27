import { getBrandConfig } from '../L1-infra/config/brand.js'
import logger from '../L1-infra/logger/configLogger.js'
import type { Idea, AgendaResult, AgendaSection } from '../L0-pure/types/index.js'
import { BaseAgent } from './BaseAgent.js'
import type { ToolWithHandler } from './BaseAgent.js'

const SYSTEM_PROMPT = `You are a recording agenda planner for a content creator. You take multiple video ideas and structure them into a single cohesive recording agenda with natural transitions, time estimates, and recording notes.

## Rules
- You MUST use tools for ALL output. Never respond with plain text.
- Structure ideas into a logical recording flow that feels natural, not disjointed.
- Estimate ~2 minutes per talking point as a baseline, then adjust for complexity.
- Write an engaging intro hook that previews what the video will cover.
- Write a CTA outro (subscribe, like, follow).
- Include recording notes for each section: energy cues, visual references, key phrases to emphasize.
- Transitions between sections should feel conversational, not abrupt.

## Process
1. Call get_brand_context to load the creator's voice, style, and content pillars.
2. Call get_idea_details for each idea to inspect the full content.
3. Call add_section for each idea in the order you want them recorded. Set the order field sequentially starting at 1.
4. Call set_intro with an engaging opening hook.
5. Call set_outro with a closing CTA.
6. Call finalize_agenda with a brief summary of the agenda.

## Ordering Strategy
- Lead with the most attention-grabbing idea (strongest hook).
- Group related topics so transitions feel natural.
- End with the most forward-looking or actionable topic (leaves viewers motivated).
- Alternate energy levels: high-energy topic → reflective topic → high-energy.`

export class AgendaAgent extends BaseAgent {
  private ideas: readonly Idea[] = []
  private sections: AgendaSection[] = []
  private intro = ''
  private outro = ''
  private finalized = false

  constructor(ideas: readonly Idea[], model?: string) {
    super('AgendaAgent', SYSTEM_PROMPT, undefined, model)
    this.ideas = ideas
  }

  protected resetForRetry(): void {
    this.sections = []
    this.intro = ''
    this.outro = ''
    this.finalized = false
  }

  protected getTools(): ToolWithHandler[] {
    return [
      {
        name: 'get_brand_context',
        description: 'Return the creator brand context including voice, style, and content pillars.',
        parameters: {
          type: 'object',
          properties: {},
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('get_brand_context', args),
      },
      {
        name: 'get_idea_details',
        description: 'Return the full details of an idea by its index in the provided array.',
        parameters: {
          type: 'object',
          properties: {
            ideaIndex: {
              type: 'number',
              description: 'Zero-based index of the idea in the provided array.',
            },
          },
          required: ['ideaIndex'],
          additionalProperties: false,
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('get_idea_details', args),
      },
      {
        name: 'add_section',
        description: 'Add a recording section to the agenda. Call once per idea, in the order they should be recorded.',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Section title for the recording outline.',
            },
            ideaIssueNumber: {
              type: 'number',
              description: 'GitHub Issue number of the idea this section covers.',
            },
            estimatedMinutes: {
              type: 'number',
              description: 'Estimated recording time in minutes for this section.',
            },
            talkingPoints: {
              type: 'array',
              items: { type: 'string' },
              description: 'Talking points to cover in this section.',
            },
            transition: {
              type: 'string',
              description: 'Transition phrase to lead into the next section. Empty string for the last section.',
            },
            notes: {
              type: 'string',
              description: 'Recording notes: energy cues, visual references, key phrases to emphasize.',
            },
          },
          required: ['title', 'ideaIssueNumber', 'estimatedMinutes', 'talkingPoints', 'transition', 'notes'],
          additionalProperties: false,
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('add_section', args),
      },
      {
        name: 'set_intro',
        description: 'Set the opening hook text for the recording.',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Opening hook text that previews what the video will cover.',
            },
          },
          required: ['text'],
          additionalProperties: false,
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('set_intro', args),
      },
      {
        name: 'set_outro',
        description: 'Set the closing CTA text for the recording.',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Closing call-to-action text (subscribe, like, follow).',
            },
          },
          required: ['text'],
          additionalProperties: false,
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('set_outro', args),
      },
      {
        name: 'finalize_agenda',
        description: 'Confirm that the agenda is complete. Call this after all sections, intro, and outro are set.',
        parameters: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'Brief summary of the agenda structure and reasoning.',
            },
          },
          required: ['summary'],
          additionalProperties: false,
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('finalize_agenda', args),
      },
    ]
  }

  protected async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'get_brand_context':
        return getBrandConfig()
      case 'get_idea_details':
        return this.handleGetIdeaDetails(args)
      case 'add_section':
        return this.handleAddSection(args)
      case 'set_intro':
        return this.handleSetIntro(args)
      case 'set_outro':
        return this.handleSetOutro(args)
      case 'finalize_agenda':
        return this.handleFinalizeAgenda(args)
      default:
        return { error: `Unknown tool: ${toolName}` }
    }
  }

  private handleGetIdeaDetails(args: Record<string, unknown>): Idea | { error: string } {
    const ideaIndex = Number(args.ideaIndex ?? -1)
    if (ideaIndex < 0 || ideaIndex >= this.ideas.length) {
      return { error: `Invalid ideaIndex ${ideaIndex}. Must be 0–${this.ideas.length - 1}.` }
    }
    return this.ideas[ideaIndex]
  }

  private handleAddSection(args: Record<string, unknown>): { added: true; order: number } {
    const section: AgendaSection = {
      order: this.sections.length + 1,
      title: String(args.title ?? ''),
      ideaIssueNumber: Number(args.ideaIssueNumber ?? 0),
      estimatedMinutes: Number(args.estimatedMinutes ?? 2),
      talkingPoints: (args.talkingPoints as string[]) ?? [],
      transition: String(args.transition ?? ''),
      notes: String(args.notes ?? ''),
    }
    this.sections.push(section)
    logger.info(`[AgendaAgent] Added section ${section.order}: ${section.title}`)
    return { added: true, order: section.order }
  }

  private handleSetIntro(args: Record<string, unknown>): { set: true; field: 'intro' } {
    this.intro = String(args.text ?? '')
    logger.info(`[AgendaAgent] Set intro (${this.intro.length} chars)`)
    return { set: true, field: 'intro' }
  }

  private handleSetOutro(args: Record<string, unknown>): { set: true; field: 'outro' } {
    this.outro = String(args.text ?? '')
    logger.info(`[AgendaAgent] Set outro (${this.outro.length} chars)`)
    return { set: true, field: 'outro' }
  }

  private handleFinalizeAgenda(args: Record<string, unknown>): { finalized: true; summary: string } {
    this.finalized = true
    const summary = String(args.summary ?? '')
    logger.info(`[AgendaAgent] Agenda finalized: ${summary}`)
    return { finalized: true, summary }
  }

  async generateAgenda(ideas: readonly Idea[]): Promise<AgendaResult> {
    this.ideas = ideas
    this.resetForRetry()

    const startTime = Date.now()

    const ideaList = ideas.map((idea, i) =>
      `${i}. **#${idea.issueNumber} — ${idea.topic}**\n   Hook: ${idea.hook}\n   Talking points: ${idea.talkingPoints.join(', ')}`,
    ).join('\n')

    const userMessage = [
      `Create a recording agenda from these ${ideas.length} ideas:`,
      '',
      ideaList,
      '',
      'Structure them into a cohesive recording flow. Call get_brand_context first, then get_idea_details for each, then add_section for each in recording order, then set_intro, set_outro, and finalize_agenda.',
    ].join('\n')

    await this.run(userMessage)

    const estimatedDuration = this.sections.reduce((sum, s) => sum + s.estimatedMinutes, 0)
    const markdown = this.buildMarkdown(estimatedDuration)

    return {
      sections: this.sections,
      intro: this.intro,
      outro: this.outro,
      estimatedDuration,
      markdown,
      durationMs: Date.now() - startTime,
    }
  }

  private buildMarkdown(estimatedDuration: number): string {
    const lines: string[] = [
      '# Recording Agenda',
      '',
      `**Estimated Duration:** ${estimatedDuration} minutes`,
      `**Ideas Covered:** ${this.sections.length}`,
      '',
      '## Opening',
      '',
      this.intro,
    ]

    for (const section of this.sections) {
      lines.push(
        '',
        '---',
        '',
        `## Section ${section.order}: ${section.title}`,
        `**Idea:** #${section.ideaIssueNumber} | **Time:** ~${section.estimatedMinutes} min`,
        '',
        '### Talking Points',
        ...section.talkingPoints.map(p => `- ${p}`),
        '',
        '### Notes',
        section.notes,
      )

      if (section.transition) {
        lines.push(
          '',
          '### Transition',
          `> ${section.transition}`,
        )
      }
    }

    lines.push(
      '',
      '---',
      '',
      '## Closing',
      '',
      this.outro,
      '',
    )

    return lines.join('\n')
  }

  async destroy(): Promise<void> {
    await super.destroy()
  }
}

export async function generateAgendaFromIdeas(ideas: readonly Idea[]): Promise<AgendaResult> {
  const agent = new AgendaAgent(ideas)
  try {
    return await agent.generateAgenda(ideas)
  } finally {
    await agent.destroy()
  }
}
