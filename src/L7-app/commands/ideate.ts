import { initConfig } from '../../L1-infra/config/environment.js'
import { createIdea, listIdeas } from '../../L3-services/ideaService/ideaService.js'
import { generateIdeas } from '../../L6-pipeline/ideation.js'
import { Platform } from '../../L0-pure/types/index.js'
import type { CreateIdeaInput } from '../../L0-pure/types/index.js'

const VALID_PLATFORMS = new Set(Object.values(Platform))

export interface IdeateCommandOptions {
  topics?: string
  count?: string
  output?: string
  brand?: string
  list?: boolean
  status?: string
  format?: 'table' | 'json'
  add?: boolean
  topic?: string
  hook?: string
  audience?: string
  platforms?: string
  keyTakeaway?: string
  talkingPoints?: string
  tags?: string
  publishBy?: string
  trendContext?: string
  ai?: boolean
  prompt?: string
}

export async function runIdeate(options: IdeateCommandOptions = {}): Promise<void> {
  initConfig()

  if (options.add) {
    await handleAdd(options)
    return
  }

  if (options.list) {
    const ideas = await listIdeas()
    const filtered = options.status
      ? ideas.filter((idea) => idea.status === options.status)
      : ideas

    if (options.format === 'json') {
      const jsonIdeas = filtered.map((idea) => ({
        issueNumber: idea.issueNumber,
        id: idea.id,
        topic: idea.topic,
        hook: idea.hook,
        audience: idea.audience,
        platforms: idea.platforms,
        status: idea.status,
      }))
      console.log(JSON.stringify(jsonIdeas, null, 2))
      return
    }

    if (filtered.length === 0) {
      console.log('No ideas found.')
      if (options.status) {
        console.log(`(filtered by status: ${options.status})`)
      }
      console.log('\nRun `vidpipe ideate` to generate new ideas.')
      return
    }

    console.log('\n💡 Content Ideas\n')
    console.log(`${'ID'.padEnd(30)} ${'Topic'.padEnd(35)} ${'Status'.padEnd(12)} ${'Platforms'}`)
    console.log('─'.repeat(95))
    for (const idea of filtered) {
      console.log(
        `${idea.id.padEnd(30)} ${idea.topic.substring(0, 33).padEnd(35)} ${idea.status.padEnd(12)} ${idea.platforms.join(', ')}`,
      )
    }
    console.log(`\n${filtered.length} idea(s) total`)
    return
  }

  const seedTopics = options.topics?.split(',').map(t => t.trim()).filter(Boolean)
  const count = options.count ? parseInt(options.count, 10) : 5

  if (options.format !== 'json') {
    console.log('\n🧠 Generating content ideas...\n')
    if (options.prompt) {
      console.log(`Prompt: ${options.prompt}`)
    }
    if (seedTopics?.length) {
      console.log(`Seed topics: ${seedTopics.join(', ')}`)
    }
    console.log(`Target count: ${count}\n`)
  }

  const ideas = await generateIdeas({
    seedTopics,
    count,
    ideasDir: options.output,
    brandPath: options.brand,
    prompt: options.prompt,
  })

  if (ideas.length === 0) {
    if (options.format === 'json') {
      console.log(JSON.stringify([], null, 2))
    } else {
      console.log('No ideas were generated. Check your API key configuration.')
    }
    return
  }

  if (options.format === 'json') {
    const jsonIdeas = ideas.map((idea) => ({
      issueNumber: idea.issueNumber,
      id: idea.id,
      topic: idea.topic,
      hook: idea.hook,
      audience: idea.audience,
      platforms: idea.platforms,
      status: idea.status,
    }))
    console.log(JSON.stringify(jsonIdeas, null, 2))
    return
  }

  console.log(`\n✅ Generated ${ideas.length} idea(s):\n`)
  for (const idea of ideas) {
    console.log(`  📌 ${idea.topic}`)
    console.log(`     Hook: ${idea.hook}`)
    console.log(`     Audience: ${idea.audience}`)
    console.log(`     Platforms: ${idea.platforms.join(', ')}`)
    console.log(`     Status: ${idea.status}`)
    console.log('')
  }

  console.log('Ideas saved to the GitHub-backed idea service.')
  console.log('Use `vidpipe ideate --list` to view all ideas.')
  console.log('Use `vidpipe process video.mp4 --ideas <issueNumber1>,<issueNumber2>` to link ideas to a recording.')
}

function parseCommaSeparated(value: string | undefined): string[] {
  if (!value) return []
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

function parsePlatforms(value: string | undefined): Platform[] {
  if (!value) return [Platform.YouTube]
  const names = parseCommaSeparated(value)
  const platforms: Platform[] = []
  for (const name of names) {
    const lower = name.toLowerCase()
    if (!VALID_PLATFORMS.has(lower as Platform)) {
      throw new Error(`Invalid platform "${name}". Valid platforms: ${[...VALID_PLATFORMS].join(', ')}`)
    }
    platforms.push(lower as Platform)
  }
  return platforms.length > 0 ? platforms : [Platform.YouTube]
}

function defaultPublishBy(): string {
  const date = new Date()
  date.setDate(date.getDate() + 14)
  return date.toISOString().split('T')[0]
}

function buildDirectInput(options: IdeateCommandOptions): CreateIdeaInput {
  const topic = options.topic!
  const hook = options.hook ?? topic
  const audience = options.audience ?? 'developers'
  const platforms = parsePlatforms(options.platforms)
  const keyTakeaway = options.keyTakeaway ?? hook
  const talkingPoints = parseCommaSeparated(options.talkingPoints)
  const tags = parseCommaSeparated(options.tags)
  const publishBy = options.publishBy ?? defaultPublishBy()
  const trendContext = options.trendContext

  return { topic, hook, audience, keyTakeaway, talkingPoints, platforms, tags, publishBy, trendContext }
}

async function handleAdd(options: IdeateCommandOptions): Promise<void> {
  if (!options.topic) {
    throw new Error('--topic is required when using --add')
  }

  // Commander's --no-ai flag sets options.ai to false
  const useAI = options.ai !== false

  if (useAI) {
    // Full agent with MCP research — generates and creates the idea internally
    const ideas = await generateIdeas({
      seedTopics: [options.topic],
      count: 1,
      singleTopic: true,
      brandPath: options.brand,
      prompt: options.prompt,
    })

    const idea = ideas[0]
    if (!idea) {
      throw new Error('IdeationAgent did not create an idea')
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(idea, null, 2))
    } else {
      console.log(`Created idea #${idea.issueNumber}: "${idea.topic}"`)
    }
  } else {
    const input = buildDirectInput(options)
    const idea = await createIdea(input)

    if (options.format === 'json') {
      console.log(JSON.stringify(idea, null, 2))
    } else {
      console.log(`Created idea #${idea.issueNumber}: "${idea.topic}"`)
    }
  }
}
