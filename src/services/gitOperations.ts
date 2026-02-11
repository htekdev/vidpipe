import { execCommandSync } from '../core/process.js'
import { getConfig } from '../config/environment'
import logger from '../config/logger'

export async function commitAndPush(videoSlug: string, message?: string): Promise<void> {
  const { REPO_ROOT } = getConfig()
  const commitMessage = message || `Auto-processed video: ${videoSlug}`

  try {
    logger.info(`Staging all changes in ${REPO_ROOT}`)
    execCommandSync('git add -A', { cwd: REPO_ROOT, stdio: 'pipe' })

    logger.info(`Committing: ${commitMessage}`)
    execCommandSync(`git commit -m "${commitMessage}"`, { cwd: REPO_ROOT, stdio: 'pipe' })

    const branch = execCommandSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT, stdio: 'pipe' })
    logger.info(`Pushing to origin ${branch}`)
    execCommandSync(`git push origin ${branch}`, { cwd: REPO_ROOT, stdio: 'pipe' })

    logger.info('Git commit and push completed successfully')
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('nothing to commit')) {
      logger.info('Nothing to commit, working tree clean')
      return
    }
    logger.error(`Git operation failed: ${msg}`)
    throw error
  }
}

export async function stageFiles(patterns: string[]): Promise<void> {
  const { REPO_ROOT } = getConfig()

  for (const pattern of patterns) {
    try {
      logger.info(`Staging files matching: ${pattern}`)
      execCommandSync(`git add ${pattern}`, { cwd: REPO_ROOT, stdio: 'pipe' })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error(`Failed to stage pattern "${pattern}": ${msg}`)
      throw error
    }
  }
}
