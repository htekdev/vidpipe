import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getConfig } from '../../../L1-infra/config/environment.js'
import { readIdeaBank } from '../../../L1-infra/ideaStore/ideaStore.js'

const mockState = vi.hoisted(() => ({
  systemPrompt: '',
  mcpServers: undefined as Record<string, unknown> | undefined,
  runScenario: 'ideas' as 'ideas' | 'inspect',
}))

vi.mock('../../../L3-services/llm/providerFactory.js', async () => {
  return {
    getProvider: () => ({
      name: 'copilot',
      isAvailable: () => true,
      getDefaultModel: () => 'mock-model',
      createSession: async (config: {
        systemPrompt: string
        tools: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<unknown> }>
        mcpServers?: Record<string, unknown>
      }) => {
        mockState.systemPrompt = config.systemPrompt
        mockState.mcpServers = config.mcpServers

        return {
          on: () => {},
          close: async () => {},
          sendAndWait: async () => {
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

describe('IdeationAgent', () => {
  let sandboxDir: string
  let ideasDir: string
  let brandPath: string
  let config: ReturnType<typeof getConfig>

  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(tmpdir(), 'ideation-agent-'))
    ideasDir = join(sandboxDir, 'ideas')
    brandPath = join(sandboxDir, 'brand.json')
    config = getConfig()

    config.EXA_API_KEY = ''
    config.YOUTUBE_API_KEY = ''
    config.PERPLEXITY_API_KEY = ''
    mockState.systemPrompt = ''
    mockState.mcpServers = undefined
    mockState.runScenario = 'ideas'

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

  test('IdeationAgent.REQ-001 - generateIdeas includes seed topics and content pillars in the prompt', async () => {
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
  })

  test('IdeationAgent.REQ-002 - create_idea persists draft ideas and generateIdeas returns them', async () => {
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

    const storedIdeas = await readIdeaBank(ideasDir)
    expect(storedIdeas.map((idea) => idea.id).sort()).toEqual(ideas.map((idea) => idea.id).sort())
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
})
