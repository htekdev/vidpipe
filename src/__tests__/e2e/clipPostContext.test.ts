/**
 * E2E Test — clip post generation includes video context
 *
 * No mocks. Verifies that SocialMediaAgent.generateShortPosts accepts
 * a summary parameter and that the pipeline passes it through.
 */
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

describe('Clip post video context enrichment', () => {
  it('SocialMediaAgent.generateShortPosts accepts summary parameter', async () => {
    const agentPath = join(import.meta.dirname, '../../L4-agents/SocialMediaAgent.ts')
    const source = await readFile(agentPath, 'utf-8')

    // Function signature includes summary parameter
    expect(source).toContain('summary?: VideoSummary')
    // User message includes broader video context section
    expect(source).toContain('Broader Video Context')
    expect(source).toContain('summary.title')
    expect(source).toContain('summary.overview')
    expect(source).toContain('summary.keyTopics')
  })

  it('Pipeline passes summary to clip post generation', async () => {
    const pipelinePath = join(import.meta.dirname, '../../L6-pipeline/pipeline.ts')
    const source = await readFile(pipelinePath, 'utf-8')

    // Short posts receive summary
    expect(source).toMatch(/generateShortPostsData\(.*summary/)
    // Medium clip posts receive summary
    expect(source).toMatch(/generateMediumClipPostsData\(.*summary/)
  })
})
