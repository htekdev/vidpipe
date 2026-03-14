import { initConfig } from '../../L1-infra/config/environment.js'
import { readIdeaBank } from '../../L1-infra/ideaStore/ideaStore.js'
import { generateIdeas } from '../../L6-pipeline/ideation.js'

export interface IdeateCommandOptions {
  topics?: string
  count?: string
  output?: string
  brand?: string
  list?: boolean
  status?: string
}

export async function runIdeate(options: IdeateCommandOptions = {}): Promise<void> {
  initConfig()

  if (options.list) {
    const ideas = await readIdeaBank(options.output)
    const filtered = options.status
      ? ideas.filter(i => i.status === options.status)
      : ideas

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

  console.log('\n🧠 Generating content ideas...\n')
  if (seedTopics?.length) {
    console.log(`Seed topics: ${seedTopics.join(', ')}`)
  }
  console.log(`Target count: ${count}\n`)

  const ideas = await generateIdeas({
    seedTopics,
    count,
    ideasDir: options.output,
    brandPath: options.brand,
  })

  if (ideas.length === 0) {
    console.log('No ideas were generated. Check your API key configuration.')
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

  console.log('Ideas saved to ./ideas/ directory.')
  console.log('Use `vidpipe ideate --list` to view all ideas.')
  console.log('Use `vidpipe process video.mp4 --ideas <id1>,<id2>` to link ideas to a recording.')
}
