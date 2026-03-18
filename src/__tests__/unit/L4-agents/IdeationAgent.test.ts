import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Platform, type CreateIdeaInput, type Idea } from '../../../L0-pure/types/index.js'
import { getConfig } from '../../../L1-infra/config/environment.js'

const mockState = vi.hoisted(() => ({
  systemPrompt: '',
  lastUserMessage: '',
  mcpServers: undefined as Record<string, unknown> | undefined,
  tools: [] as Array<{
    name: string
    parameters?: Record<string, unknown>
    handler: (args: Record<string, unknown>) => Promise<unknown>
  }>,
  runScenario: 'ideas' as 'ideas' | 'inspect',
}))

const mockListIdeas = vi.hoisted(() => vi.fn())
const mockCreateIdea = vi.hoisted(() => vi.fn())
const mockGetIdea = vi.hoisted(() => vi.fn())
const mockSearchIdeas = vi.hoisted(() => vi.fn())
const mockFindRelatedIdeas = vi.hoisted(() => vi.fn())
const mockUpdateIdea = vi.hoisted(() => vi.fn())

vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  listIdeas: mockListIdeas,
  createIdea: mockCreateIdea,
  getIdea: mockGetIdea,
  searchIdeas: mockSearchIdeas,
  findRelatedIdeas: mockFindRelatedIdeas,
  updateIdea: mockUpdateIdea,
}))

vi.mock('../../../L3-services/llm/providerFactory.js', async () => {
  return {
    getProvider: () => ({
      name: 'copilot',
      isAvailable: () => true,
      getDefaultModel: () => 'mock-model',
      createSession: async (config: {
        systemPrompt: string
        tools: Array<{ name: string; parameters?: Record<string, unknown>; handler: (args: Record<string, unknown>) => Promise<unknown> }>
        mcpServers?: Record<string, unknown>
      }) => {
        mockState.systemPrompt = config.systemPrompt
        mockState.mcpServers = config.mcpServers
        mockState.tools = config.tools

        return {
          on: () => {},
          close: async () => {},
          sendAndWait: async (userMessage?: string) => {
            if (userMessage) mockState.lastUserMessage = userMessage
            if (mockState.runScenario === 'ideas') {
              const getBrandContext = config.tools.find((tool) => tool.name === 'get_brand_context')
              const getPastIdeas = config.tools.find((tool) => tool.name === 'get_past_ideas')
              const createIdea = config.tools.find((tool) => tool.name === 'create_idea')
              const finalizeIdeas = config.tools.find((tool) => tool.name === 'finalize_ideas')

              await getBrandContext?.handler({})
              await getPastIdeas?.handler({})
              await createIdea?.handler({
                id: 'copilot-release-recap',
                topic: 'GitHub Copilot CLI Release Recap',
                hook: 'The 3 Copilot CLI updates that matter this week',
                audience: 'Developers evaluating Copilot CLI changes',
                keyTakeaway: 'Weekly release notes become actionable when framed around real workflows.',
                talkingPoints: ['Newest CLI capabilities', 'Who benefits first', 'How to test the update today'],
                platforms: ['youtube', 'linkedin', 'x'],
                tags: ['copilot', 'release-notes', 'developer-tools'],
                publishBy: '2026-03-18',
                trendContext: 'Weekly Copilot releases create a recurring news peg for timely commentary.',
              })
              await createIdea?.handler({
                id: 'agentic-devops-guardrails',
                topic: 'Agentic DevOps Guardrails That Actually Work',
                hook: 'Most AI coding guardrails fail before the second sprint',
                audience: 'Platform engineers and DevOps leads',
                keyTakeaway: 'Good guardrails block risky behavior without slowing trusted developer flows.',
                talkingPoints: ['Where teams overcorrect', 'Hookflow-style guardrails', 'How to measure signal vs friction'],
                platforms: ['youtube', 'tiktok', 'linkedin'],
                tags: ['devops', 'agents', 'governance'],
                publishBy: '2026-03-27',
                trendContext: 'Teams are actively adding governance around agentic coding and CI/CD workflows.',
              })
              await createIdea?.handler({
                id: 'azure-ai-change-log',
                topic: 'Azure AI Changes Worth Shipping This Month',
                hook: 'Skip the noise: these Azure AI updates are the real unlocks',
                audience: 'Azure developers shipping AI features',
                keyTakeaway: 'Monthly cloud change logs are useful only when tied to concrete developer actions.',
                talkingPoints: ['What changed', 'Which teams should care', 'Immediate next experiments'],
                platforms: ['youtube', 'instagram', 'x'],
                tags: ['azure', 'ai', 'cloud'],
                publishBy: '2026-06-13',
                trendContext: 'Monthly Azure AI releases create urgency for explainers and implementation guidance.',
              })
              await finalizeIdeas?.handler({})
            }

            return {
              content: 'done',
              toolCalls: [],
              usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
              durationMs: 5,
            }
          },
        }
      },
    }),
  }
})

function buildIdeaInput(overrides: Partial<CreateIdeaInput> = {}): CreateIdeaInput {
  return {
    topic: 'GitHub Copilot CLI Release Recap',
    hook: 'The 3 Copilot CLI updates that matter this week',
    audience: 'Developers evaluating Copilot CLI changes',
    keyTakeaway: 'Weekly release notes become actionable when framed around real workflows.',
    talkingPoints: ['Newest CLI capabilities', 'Who benefits first', 'How to test the update today'],
    platforms: [Platform.YouTube, Platform.LinkedIn, Platform.X],
    tags: ['copilot', 'release-notes', 'developer-tools'],
    publishBy: '2026-03-18',
    trendContext: 'Weekly Copilot releases create a recurring news peg for timely commentary.',
    ...overrides,
  }
}

function buildPersistedIdea(input: CreateIdeaInput, issueNumber: number): Idea {
  return {
    issueNumber,
    issueUrl: `https://github.com/htekdev/content-management/issues/${issueNumber}`,
    repoFullName: 'htekdev/content-management',
    id: `idea-${issueNumber}`,
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...input,
  }
}

describe('IdeationAgent', () => {
  let sandboxDir: string
  let ideasDir: string
  let brandPath: string
  let config: ReturnType<typeof getConfig>

  const getTool = (name: string) => {
    const tool = mockState.tools.find((candidate) => candidate.name === name)
    expect(tool).toBeDefined()
    return tool!
  }

  const bootstrapInspectTools = async (): Promise<void> => {
    const { generateIdeas } = await import('../../../L4-agents/IdeationAgent.js')
    mockState.runScenario = 'inspect'
    await generateIdeas({
      count: 3,
      brandPath,
      ideasDir,
    })
  }

  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(tmpdir(), 'ideation-agent-'))
    ideasDir = join(sandboxDir, 'ideas')
    brandPath = join(sandboxDir, 'brand.json')
    config = getConfig()

    config.EXA_API_KEY = ''
    config.YOUTUBE_API_KEY = ''
    config.PERPLEXITY_API_KEY = ''
    mockState.systemPrompt = ''
    mockState.lastUserMessage = ''
    mockState.mcpServers = undefined
    mockState.tools = []
    mockState.runScenario = 'ideas'
    mockListIdeas.mockReset().mockResolvedValue([])
    mockCreateIdea.mockReset()
    mockGetIdea.mockReset().mockResolvedValue(undefined)
    mockSearchIdeas.mockReset().mockResolvedValue([])
    mockFindRelatedIdeas.mockReset().mockResolvedValue([])
    mockUpdateIdea.mockReset()
    let nextIssueNumber = 101
    mockCreateIdea.mockImplementation(async (input: CreateIdeaInput) => buildPersistedIdea(input, nextIssueNumber++))

    await writeFile(
      brandPath,
      JSON.stringify({
        name: 'Test Creator',
        handle: '@testcreator',
        tagline: 'Weekly agentic engineering breakdowns',
        voice: {
          tone: 'energetic and practical',
          personality: 'builder-first teacher',
          style: 'direct and example-driven',
        },
        advocacy: {
          primary: ['GitHub Copilot', 'Azure'],
          interests: ['Agentic DevOps', 'Platform engineering'],
          avoids: ['empty hype'],
        },
        customVocabulary: ['Copilot', 'Azure', 'MCP'],
        hashtags: { always: [], preferred: [], platforms: {} },
        contentGuidelines: {
          shortsFocus: 'Fast developer wins',
          blogFocus: 'Practical walkthroughs',
          socialFocus: 'Timely hot takes backed by examples',
        },
        contentPillars: [
          {
            pillar: 'GitHub Copilot Deep Dives',
            description: 'Weekly coverage of Copilot CLI releases and workflows',
            frequency: 'weekly',
            formats: ['video', 'social'],
          },
          {
            pillar: 'Agentic DevOps',
            description: 'Governance and testing patterns for AI-assisted delivery',
            frequency: '2x/month',
            formats: ['video', 'blog'],
          },
        ],
      }),
      'utf8',
    )
  })

  afterEach(async () => {
    await rm(sandboxDir, { recursive: true, force: true })
  })

  test('IdeationAgent.REQ-001 - generateIdeas includes seed topics, content pillars, and publish-by guidance in the prompt', async () => {
    const { generateIdeas } = await import('../../../L4-agents/IdeationAgent.js')

    await generateIdeas({
      seedTopics: ['Copilot CLI', 'Azure AI'],
      count: 3,
      brandPath,
      ideasDir,
    })

    expect(mockState.systemPrompt).toContain('Seed Topics')
    expect(mockState.systemPrompt).toContain('Copilot CLI')
    expect(mockState.systemPrompt).toContain('Azure AI')
    expect(mockState.systemPrompt).toContain('GitHub Copilot Deep Dives')
    expect(mockState.systemPrompt).toContain('Agentic DevOps')
    expect(mockState.systemPrompt).toContain('Set publishBy based on timeliness')
  })

  test('IdeationAgent.REQ-002 - create_idea persists each idea as a draft GitHub Issue and returns them', async () => {
    const { generateIdeas } = await import('../../../L4-agents/IdeationAgent.js')

    const ideas = await generateIdeas({
      seedTopics: ['Copilot CLI'],
      count: 3,
      brandPath,
      ideasDir,
    })

    expect(ideas).toHaveLength(3)
    expect(ideas.every((idea) => idea.status === 'draft')).toBe(true)
    expect(ideas.every((idea) => typeof idea.createdAt === 'string' && typeof idea.updatedAt === 'string')).toBe(true)
    expect(ideas.map((idea) => idea.publishBy)).toEqual(['2026-03-18', '2026-03-27', '2026-06-13'])
    expect(ideas.map((idea) => idea.id)).toEqual(['idea-101', 'idea-102', 'idea-103'])
    expect(mockCreateIdea.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  test('IdeationAgent.REQ-003 - MCP servers are configured only for available research API keys', async () => {
    config.EXA_API_KEY = 'exa-key'
    config.YOUTUBE_API_KEY = 'youtube-key'
    config.PERPLEXITY_API_KEY = 'perplexity-key'

    const { generateIdeas } = await import('../../../L4-agents/IdeationAgent.js')

    await generateIdeas({
      count: 3,
      brandPath,
      ideasDir,
    })

    expect(mockState.mcpServers).toEqual({
      exa: {
        type: 'http',
        url: `${config.EXA_MCP_URL}?exaApiKey=${config.EXA_API_KEY}&tools=web_search_exa`,
        headers: {},
        tools: ['*'],
      },
      youtube: {
        type: 'local',
        command: 'npx',
        args: ['-y', '@htekdev/youtube-mcp-server'],
        env: { YOUTUBE_API_KEY: config.YOUTUBE_API_KEY },
        tools: ['*'],
      },
      perplexity: {
        type: 'local',
        command: 'npx',
        args: ['-y', 'perplexity-mcp'],
        env: { PERPLEXITY_API_KEY: config.PERPLEXITY_API_KEY },
        tools: ['*'],
      },
    })
  })

  test('IdeationAgent.REQ-004 - create_idea requires publishBy in tool parameters', async () => {
    const { generateIdeas } = await import('../../../L4-agents/IdeationAgent.js')

    await generateIdeas({
      count: 3,
      brandPath,
      ideasDir,
    })

    const createIdeaTool = mockState.tools.find((tool) => tool.name === 'create_idea')
    const parameters = createIdeaTool?.parameters as {
      properties?: Record<string, unknown>
      required?: string[]
    } | undefined
    const publishBy = parameters?.properties?.publishBy as { type?: string; description?: string } | undefined

    expect(publishBy).toMatchObject({
      type: 'string',
    })
    expect(publishBy?.description).toContain('Hot trends: 3-5 days')
    expect(parameters?.required).toContain('publishBy')
  })

  test('IdeationAgent.REQ-005 - generateIdeas exposes GitHub-backed idea discovery and management tools', async () => {
    const { generateIdeas } = await import('../../../L4-agents/IdeationAgent.js')

    await generateIdeas({
      count: 3,
      brandPath,
      ideasDir,
    })

    expect(mockState.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'get_past_ideas',
      'search_ideas',
      'find_related_ideas',
      'update_idea',
      'organize_ideas',
    ]))
  })

  test('IdeationAgent.REQ-006 - generateIdeas summarizes existing issue ideas in the system prompt', async () => {
    const { generateIdeas } = await import('../../../L4-agents/IdeationAgent.js')
    mockListIdeas.mockResolvedValue([
      {
        ...buildPersistedIdea(buildIdeaInput({ topic: 'Existing backlog idea' }), 42),
        status: 'ready',
      },
    ])

    await generateIdeas({
      count: 3,
      brandPath,
      ideasDir,
    })

    expect(mockState.systemPrompt).toContain('#42: Existing backlog idea [ready]')
    expect(mockState.systemPrompt).toContain('https://github.com/htekdev/content-management/issues/42')
  })

  test('IdeationAgent.REQ-007 - update_idea normalizes all supported fields and updates a generated idea', async () => {
    await bootstrapInspectTools()
    const createIdeaTool = getTool('create_idea')
    const updateIdeaTool = getTool('update_idea')

    const created = await createIdeaTool.handler(buildIdeaInput() as unknown as Record<string, unknown>) as { success: true; idea: Idea }
    const expectedUpdates = {
      topic: 'Updated idea topic',
      hook: 'Updated hook that still fits the 80 character limit',
      audience: 'Platform engineering leaders',
      keyTakeaway: 'Small governance loops beat heavyweight AI review boards.',
      talkingPoints: ['Measure workflow friction', 'Tighten guardrails by signal'],
      platforms: [Platform.YouTube, Platform.LinkedIn],
      tags: ['devops', 'governance'],
      publishBy: '2026-04-02',
      trendContext: 'Guardrail conversations are accelerating as teams operationalize coding agents.',
      status: 'ready',
    } satisfies Record<string, unknown>

    mockUpdateIdea.mockImplementation(async (issueNumber: number, updates: Record<string, unknown>) => {
      expect(issueNumber).toBe(created.idea.issueNumber)
      expect(updates).toEqual(expectedUpdates)
      return {
        ...created.idea,
        ...updates,
        updatedAt: '2026-01-02T00:00:00.000Z',
      }
    })

    const result = await updateIdeaTool.handler({
      issueNumber: created.idea.issueNumber,
      updates: {
        topic: '  Updated idea topic  ',
        hook: ' Updated hook that still fits the 80 character limit ',
        audience: '  Platform engineering leaders  ',
        keyTakeaway: ' Small governance loops beat heavyweight AI review boards. ',
        talkingPoints: ['  Measure workflow friction  ', '  ', 'Tighten guardrails by signal'],
        platforms: ['youtube', 'linkedin'],
        tags: [' devops ', '', 'governance'],
        publishBy: '2026-04-02',
        trendContext: ' Guardrail conversations are accelerating as teams operationalize coding agents. ',
        status: 'READY',
      },
    }) as { success: true; idea: Idea }

    expect(mockUpdateIdea).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      success: true,
      idea: expect.objectContaining({
        issueNumber: created.idea.issueNumber,
        topic: expectedUpdates.topic,
        hook: expectedUpdates.hook,
        audience: expectedUpdates.audience,
        keyTakeaway: expectedUpdates.keyTakeaway,
        talkingPoints: expectedUpdates.talkingPoints,
        platforms: expectedUpdates.platforms,
        tags: expectedUpdates.tags,
        publishBy: expectedUpdates.publishBy,
        trendContext: expectedUpdates.trendContext,
        status: expectedUpdates.status,
      }),
    })
  })

  test('IdeationAgent.REQ-008 - update_idea rejects invalid arguments and invalid hook lengths', async () => {
    await bootstrapInspectTools()
    const updateIdeaTool = getTool('update_idea')

    await expect(updateIdeaTool.handler({
      issueNumber: 101,
      updates: 'not-an-object',
    })).rejects.toThrow('Invalid update_idea arguments: updates must be an object')

    await expect(updateIdeaTool.handler({
      issueNumber: 0,
      updates: {},
    })).rejects.toThrow('Invalid issueNumber: expected a positive integer')

    await expect(updateIdeaTool.handler({
      issueNumber: 101,
      updates: {
        hook: 'x'.repeat(81),
      },
    })).rejects.toThrow('Idea hook must be 80 characters or fewer')
  })

  test('IdeationAgent.REQ-009 - find_related_ideas returns related ideas for an existing issue', async () => {
    await bootstrapInspectTools()
    const findRelatedIdeasTool = getTool('find_related_ideas')
    const currentIdea = buildPersistedIdea(buildIdeaInput(), 88)
    const relatedIdeas = [
      buildPersistedIdea(buildIdeaInput({ topic: 'Adjacent issue one', tags: ['copilot', 'cli'] }), 89),
      buildPersistedIdea(buildIdeaInput({ topic: 'Adjacent issue two', tags: ['copilot', 'agents'] }), 90),
    ]

    mockGetIdea.mockResolvedValue(currentIdea)
    mockFindRelatedIdeas.mockResolvedValue(relatedIdeas)

    await expect(findRelatedIdeasTool.handler({ issueNumber: 88 })).resolves.toEqual(relatedIdeas)
    expect(mockGetIdea).toHaveBeenCalledWith(88)
    expect(mockFindRelatedIdeas).toHaveBeenCalledWith(currentIdea)
  })

  test('IdeationAgent.REQ-010 - find_related_ideas errors when the issue does not exist', async () => {
    await bootstrapInspectTools()
    const findRelatedIdeasTool = getTool('find_related_ideas')
    mockGetIdea.mockResolvedValue(undefined)

    await expect(findRelatedIdeasTool.handler({ issueNumber: 404 })).rejects.toThrow(
      'Idea #404 was not found in htekdev/content-management',
    )
  })

  test('IdeationAgent.REQ-011 - organize_ideas batch updates ideas and summarizes linked issues', async () => {
    await bootstrapInspectTools()
    const organizeIdeasTool = getTool('organize_ideas')
    const createdIdea = buildPersistedIdea(buildIdeaInput({ topic: 'Created in session' }), 101)
    const existingIdea = buildPersistedIdea(buildIdeaInput({ topic: 'Already in backlog' }), 202)
    const updatedIdea = {
      ...createdIdea,
      topic: 'Refined created idea',
      status: 'ready' as const,
      tags: ['copilot', 'devops'],
      updatedAt: '2026-01-03T00:00:00.000Z',
    }
    const relatedIdea = {
      ...buildPersistedIdea(buildIdeaInput({ topic: 'Related overlap', tags: ['copilot', 'devops'] }), 303),
      status: 'ready' as const,
    }

    mockGetIdea.mockImplementation(async (issueNumber: number) => {
      if (issueNumber === createdIdea.issueNumber) {
        return createdIdea
      }
      if (issueNumber === existingIdea.issueNumber) {
        return existingIdea
      }
      return undefined
    })
    mockUpdateIdea.mockResolvedValue(updatedIdea)
    mockFindRelatedIdeas.mockResolvedValue([relatedIdea])

    const result = await organizeIdeasTool.handler({
      items: [
        {
          issueNumber: createdIdea.issueNumber,
          updates: {
            topic: '  Refined created idea  ',
            status: 'READY',
            tags: [' copilot ', 'devops'],
          },
        },
        {
          issueNumber: existingIdea.issueNumber,
          includeRelated: false,
        },
      ],
    }) as {
      success: true
      items: Array<{
        issueNumber: number
        idea: Idea
        linkedIssues: Array<Pick<Idea, 'issueNumber' | 'issueUrl' | 'topic' | 'tags'>>
      }>
    }

    expect(mockUpdateIdea).toHaveBeenCalledTimes(1)
    expect(mockUpdateIdea).toHaveBeenCalledWith(createdIdea.issueNumber, {
      topic: 'Refined created idea',
      status: 'ready',
      tags: ['copilot', 'devops'],
    })
    expect(mockFindRelatedIdeas).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      success: true,
      items: [
        {
          issueNumber: updatedIdea.issueNumber,
          idea: updatedIdea,
          linkedIssues: [{
            issueNumber: relatedIdea.issueNumber,
            issueUrl: relatedIdea.issueUrl,
            topic: relatedIdea.topic,
            tags: relatedIdea.tags,
          }],
        },
        {
          issueNumber: existingIdea.issueNumber,
          idea: existingIdea,
          linkedIssues: [],
        },
      ],
    })
    expect(result.items[0].linkedIssues[0]).not.toHaveProperty('status')
  })

  test('IdeationAgent.REQ-012 - organize_ideas validates batch arguments', async () => {
    await bootstrapInspectTools()
    const organizeIdeasTool = getTool('organize_ideas')

    await expect(organizeIdeasTool.handler({ items: 'not-an-array' })).rejects.toThrow(
      'Invalid organize_ideas arguments: items must be an array',
    )

    await expect(organizeIdeasTool.handler({
      items: [{ issueNumber: 101, updates: 'invalid' }],
    })).rejects.toThrow('Invalid organize_ideas item at index 0: updates must be an object')
  })

  test('IdeationAgent.REQ-013 - buildUserMessage includes user prompt section when prompt option is provided', async () => {
    const { generateIdeas } = await import('../../../L4-agents/IdeationAgent.js')

    await generateIdeas({
      seedTopics: ['Copilot CLI'],
      count: 3,
      brandPath,
      ideasDir,
      prompt: 'Cover this article: https://example.com/ai-safety',
    })

    expect(mockState.lastUserMessage).toContain('## User Prompt')
    expect(mockState.lastUserMessage).toContain('Cover this article: https://example.com/ai-safety')
  })

  test('IdeationAgent.REQ-014 - buildUserMessage omits user prompt section when prompt is not provided', async () => {
    const { generateIdeas } = await import('../../../L4-agents/IdeationAgent.js')

    await generateIdeas({
      seedTopics: ['Copilot CLI'],
      count: 3,
      brandPath,
      ideasDir,
    })

    expect(mockState.lastUserMessage).not.toContain('## User Prompt')
  })
})
