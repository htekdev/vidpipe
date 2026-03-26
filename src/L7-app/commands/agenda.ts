import { resolve } from 'node:path'
import { getIdeasByIds } from '../../L3-services/ideation/ideaService.js'
import { generateAgenda } from '../../L6-pipeline/ideation.js'
import { writeTextFile } from '../../L1-infra/fileSystem/fileSystem.js'
import logger from '../../L1-infra/logger/configLogger.js'
import type { Idea } from '../../L0-pure/types/index.js'

export interface AgendaCommandOptions {
  output?: string
}

export async function runAgenda(issueNumbers: string[], options: AgendaCommandOptions): Promise<void> {
  if (issueNumbers.length === 0) {
    logger.error('At least one idea issue number is required.')
    process.exit(1)
  }

  const ids = issueNumbers.flatMap(n => n.split(',')).map(s => s.trim()).filter(Boolean)
  if (ids.length === 0) {
    logger.error('No valid idea issue numbers provided.')
    process.exit(1)
  }

  let ideas: Idea[]
  try {
    ideas = await getIdeasByIds(ids)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`Failed to resolve ideas: ${msg}`)
    process.exit(1)
  }

  if (ideas.length === 0) {
    logger.error('No ideas found for the provided issue numbers.')
    process.exit(1)
  }

  logger.info(`Generating agenda for ${ideas.length} idea(s): ${ideas.map(i => `#${i.issueNumber} "${i.topic}"`).join(', ')}`)

  const result = await generateAgenda(ideas)

  // Save to file
  const outputPath = options.output
    ? resolve(options.output)
    : resolve(`agenda-${new Date().toISOString().split('T')[0]}.md`)

  await writeTextFile(outputPath, result.markdown)
  logger.info(`Agenda saved to ${outputPath}`)

  // Print summary
  console.log(`\n✅ Agenda generated (${result.estimatedDuration} min, ${result.sections.length} sections)`)
  console.log(`   Saved to: ${outputPath}\n`)

  for (const section of result.sections) {
    console.log(`   ${section.order}. ${section.title} (~${section.estimatedMinutes} min) — idea #${section.ideaIssueNumber}`)
  }
  console.log()
}
