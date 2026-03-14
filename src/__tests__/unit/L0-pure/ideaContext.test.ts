import { describe, expect, test } from 'vitest'
import { Platform, type Idea } from '../../../L0-pure/types/index.js'
import {
  buildIdeaContext,
  buildIdeaContextForBlog,
  buildIdeaContextForPosts,
  buildIdeaContextForSummary,
} from '../../../L0-pure/ideaContext/ideaContext.js'

function createIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 'idea-agentic-video-workflows',
    topic: 'Agentic video workflows',
    hook: 'The one workflow change that saves hours per video',
    audience: 'Developer creators shipping educational videos',
    keyTakeaway: 'Systematic prompts produce more reusable content than ad hoc recording.',
    talkingPoints: ['Prompt planning', 'Clip extraction', 'Distribution reuse'],
    platforms: [Platform.TikTok, Platform.YouTube],
    status: 'ready',
    tags: ['video', 'automation'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishBy: '2026-04-01',
    ...overrides,
  }
}

describe('ideaContext', () => {
  describe('REQ-001: builders return empty strings when no ideas are provided', () => {
    test('ideaContext.REQ-001 - all builders produce no prompt injection for empty input', () => {
      expect(buildIdeaContext([])).toBe('')
      expect(buildIdeaContextForPosts([])).toBe('')
      expect(buildIdeaContextForSummary([])).toBe('')
      expect(buildIdeaContextForBlog([])).toBe('')
    })
  })

  describe('REQ-002: clip and post builders include creator intent and prioritization guidance', () => {
    test('ideaContext.REQ-002 - clip and post contexts include the expected fields', () => {
      const ideas = [createIdea()]

      const clipContext = buildIdeaContext(ideas)
      expect(clipContext).toContain("## Creator's Intent for This Video")
      expect(clipContext).toContain('### Idea: Agentic video workflows')
      expect(clipContext).toContain('**Hook angle:** The one workflow change that saves hours per video')
      expect(clipContext).toContain('**Talking points:** Prompt planning, Clip extraction, Distribution reuse')
      expect(clipContext).toContain('Ensure at least one clip directly delivers the key takeaway.')

      const postContext = buildIdeaContextForPosts(ideas)
      expect(postContext).toContain("## Creator's Content Intent")
      expect(postContext).toContain('**Target platforms:** tiktok, youtube')
      expect(postContext).toContain('Use the key takeaway as the primary CTA where possible.')
    })
  })

  describe('REQ-003: summary builder condenses ideas into topic and takeaway bullets', () => {
    test('ideaContext.REQ-003 - summary context emphasizes themes and takeaways', () => {
      const summaryContext = buildIdeaContextForSummary([
        createIdea(),
        createIdea({
          id: 'idea-distribution',
          topic: 'Cross-platform distribution',
          keyTakeaway: 'Package the same insight differently for each platform.',
        }),
      ])

      expect(summaryContext).toContain("## Creator's Intent")
      expect(summaryContext).toContain('The summary should reflect these themes:')
      expect(summaryContext).toContain('**Agentic video workflows:** Systematic prompts produce more reusable content than ad hoc recording.')
      expect(summaryContext).toContain('**Cross-platform distribution:** Package the same insight differently for each platform.')
    })
  })

  describe('REQ-004: blog builder carries editorial direction and talking points', () => {
    test('ideaContext.REQ-004 - blog context includes angle, audience, and points to cover', () => {
      const blogContext = buildIdeaContextForBlog([createIdea()])

      expect(blogContext).toContain('## Editorial Direction from Creator')
      expect(blogContext).toContain('### Agentic video workflows')
      expect(blogContext).toContain('**Angle:** The one workflow change that saves hours per video')
      expect(blogContext).toContain('**Audience:** Developer creators shipping educational videos')
      expect(blogContext).toContain('**Points to cover:** Prompt planning; Clip extraction; Distribution reuse')
      expect(blogContext).toContain("The editorial angle should match the creator's intended hook.")
    })
  })
})
