import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Idea, InterviewInsights, QAPair } from '../../../L0-pure/types/index.js'
import { Platform } from '../../../L0-pure/types/index.js'

// --- L2 mock: GitHub client ---
const mockGitHubClient = vi.hoisted(() => ({
  addComment: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../L2-clients/github/githubClient.js', () => ({
  getGitHubClient: vi.fn(() => mockGitHubClient),
}))

// --- L3 peer mock: ideaService ---
const mockGetIdea = vi.hoisted(() => vi.fn())
const mockUpdateIdea = vi.hoisted(() => vi.fn())

vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  getIdea: mockGetIdea,
  updateIdea: mockUpdateIdea,
}))

import {
  formatTranscriptComment,
  loadAndValidateIdea,
  saveTranscript,
  updateIdeaFromInsights,
} from '../../../L3-services/interview/interviewService.js'

function createMockIdea(overrides: Partial<Idea> = {}): Idea {
  const issueNumber = overrides.issueNumber ?? 42
  return {
    issueNumber,
    issueUrl: overrides.issueUrl ?? `https://github.com/test/repo/issues/${issueNumber}`,
    repoFullName: overrides.repoFullName ?? 'test/repo',
    id: overrides.id ?? 'test-idea',
    topic: overrides.topic ?? 'Test Idea',
    hook: overrides.hook ?? 'Original hook',
    audience: overrides.audience ?? 'developers',
    keyTakeaway: overrides.keyTakeaway ?? 'Original takeaway',
    talkingPoints: overrides.talkingPoints ?? ['point 1', 'point 2'],
    platforms: overrides.platforms ?? [Platform.YouTube],
    status: overrides.status ?? 'draft',
    tags: overrides.tags ?? ['test'],
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00Z',
    publishBy: overrides.publishBy ?? '2026-02-01',
  }
}

function createQAPair(overrides: Partial<QAPair> = {}): QAPair {
  return {
    question: overrides.question ?? 'What problem does this solve?',
    answer: overrides.answer ?? 'It helps developers write tests faster.',
    askedAt: overrides.askedAt ?? '2026-01-01T00:00:01Z',
    answeredAt: overrides.answeredAt ?? '2026-01-01T00:00:05Z',
    questionNumber: overrides.questionNumber ?? 1,
  }
}

describe('interviewService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('REQ-003: validates idea exists before starting', () => {
    test('ideateStart.REQ-003: returns idea when found and status is draft', async () => {
      const idea = createMockIdea({ status: 'draft' })
      mockGetIdea.mockResolvedValue(idea)

      const result = await loadAndValidateIdea(42)

      expect(result).toBe(idea)
      expect(mockGetIdea).toHaveBeenCalledWith(42)
    })

    test('ideateStart.REQ-003: throws "not found" when getIdea returns null', async () => {
      mockGetIdea.mockResolvedValue(null)

      await expect(loadAndValidateIdea(42)).rejects.toThrow('Idea #42 not found')
    })
  })

  describe('REQ-004: rejects ideas not in draft status', () => {
    test('ideateStart.REQ-004: throws status error when idea status is "ready"', async () => {
      mockGetIdea.mockResolvedValue(createMockIdea({ status: 'ready' }))

      await expect(loadAndValidateIdea(42)).rejects.toThrow(
        'Idea #42 has status "ready" — only draft ideas can be started',
      )
    })

    test('ideateStart.REQ-004: throws status error when idea status is "recorded"', async () => {
      mockGetIdea.mockResolvedValue(createMockIdea({ status: 'recorded' }))

      await expect(loadAndValidateIdea(42)).rejects.toThrow(
        'Idea #42 has status "recorded" — only draft ideas can be started',
      )
    })
  })

  describe('REQ-031: comment uses vidpipe:idea-comment marker', () => {
    test('ideateStart.REQ-031: includes vidpipe comment marker', () => {
      const transcript = [createQAPair()]
      const result = formatTranscriptComment(transcript)

      expect(result).toContain('<!-- vidpipe:idea-comment -->')
    })

    test('ideateStart.REQ-031: includes interview-transcript metadata marker', () => {
      const result = formatTranscriptComment([createQAPair()])
      expect(result).toContain('"type":"interview-transcript"')
    })

    test('includes question and answer text', () => {
      const transcript = [
        createQAPair({
          question: 'Why should viewers care?',
          answer: 'Because it saves them hours of debugging.',
          questionNumber: 1,
        }),
      ]
      const result = formatTranscriptComment(transcript)

      expect(result).toContain('### Q1: Why should viewers care?')
      expect(result).toContain('> Because it saves them hours of debugging.')
    })

    test('includes all Q&A pairs with correct numbering', () => {
      const transcript = [
        createQAPair({ question: 'First?', questionNumber: 1 }),
        createQAPair({ question: 'Second?', questionNumber: 2 }),
        createQAPair({ question: 'Third?', questionNumber: 3 }),
      ]
      const result = formatTranscriptComment(transcript)

      expect(result).toContain('### Q1: First?')
      expect(result).toContain('### Q2: Second?')
      expect(result).toContain('### Q3: Third?')
      expect(result).toContain('**Questions asked:** 3')
    })
  })

  describe('REQ-030: transcript saved as GitHub Issue comment', () => {
    test('ideateStart.REQ-030: calls addComment with formatted markdown on the correct issue', async () => {
      const transcript = [createQAPair()]
      await saveTranscript(42, transcript)

      expect(mockGitHubClient.addComment).toHaveBeenCalledOnce()
      expect(mockGitHubClient.addComment).toHaveBeenCalledWith(42, expect.any(String))
    })

    test('ideateStart.REQ-030: comment body contains vidpipe marker and Q&A content', async () => {
      const transcript = [
        createQAPair({
          question: 'What is the hook?',
          answer: 'A surprising stat about test coverage.',
          questionNumber: 1,
        }),
      ]
      await saveTranscript(42, transcript)

      const body = mockGitHubClient.addComment.mock.calls[0][1] as string
      expect(body).toContain('<!-- vidpipe:idea-comment -->')
      expect(body).toContain('### Q1: What is the hook?')
      expect(body).toContain('> A surprising stat about test coverage.')
    })
  })

  describe('REQ-032: insights persisted to idea fields', () => {
    test('ideateStart.REQ-032: calls updateIdea with refined scalar fields', async () => {
      mockUpdateIdea.mockResolvedValue(undefined)

      const insights: InterviewInsights = {
        hook: 'A better hook',
        keyTakeaway: 'A sharper takeaway',
        audience: 'senior engineers',
      }

      await updateIdeaFromInsights(42, insights)

      expect(mockUpdateIdea).toHaveBeenCalledWith(42, {
        hook: 'A better hook',
        keyTakeaway: 'A sharper takeaway',
        audience: 'senior engineers',
      })
    })

    test('ideateStart.REQ-032: replaces talking points directly (no merge)', async () => {
      mockUpdateIdea.mockResolvedValue(undefined)

      const insights: InterviewInsights = {
        talkingPoints: ['new point 1', 'new point 2', 'new point 3'],
      }

      await updateIdeaFromInsights(42, insights)

      expect(mockUpdateIdea).toHaveBeenCalledWith(42, {
        talkingPoints: ['new point 1', 'new point 2', 'new point 3'],
      })
    })

    test('ideateStart.REQ-032: replaces tags directly (no merge)', async () => {
      mockUpdateIdea.mockResolvedValue(undefined)

      const insights: InterviewInsights = {
        tags: ['new-tag-1', 'new-tag-2'],
      }

      await updateIdeaFromInsights(42, insights)

      expect(mockUpdateIdea).toHaveBeenCalledWith(42, {
        tags: ['new-tag-1', 'new-tag-2'],
      })
    })

    test('ideateStart.REQ-032: does not call updateIdea when insights are empty', async () => {
      await updateIdeaFromInsights(42, {})

      expect(mockUpdateIdea).not.toHaveBeenCalled()
    })

    test('ideateStart.REQ-032: includes trendContext when provided', async () => {
      mockUpdateIdea.mockResolvedValue(undefined)

      await updateIdeaFromInsights(42, { trendContext: 'AI hype cycle' })

      expect(mockUpdateIdea).toHaveBeenCalledWith(42, {
        trendContext: 'AI hype cycle',
      })
    })
  })
})
