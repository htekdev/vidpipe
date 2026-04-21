#!/usr/bin/env npx tsx

import { runMigrateIdeasToGitHubCli } from '../src/L7-app/commands/migrateIdeasToGithub.js'

runMigrateIdeasToGitHubCli(process.argv.slice(2))
  .then((summary) => {
    if (summary.failures.length > 0) {
      process.exitCode = 1
    }
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Idea migration failed: ${message}`)
    process.exitCode = 1
  })
