import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpdateIdea = vi.hoisted(() => vi.fn())
const mockGetIdea = vi.hoisted(() => vi.fn())
const mockInitConfig = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/L3-services/ideaService/ideaService.js', () => ({
  updateIdea: mockUpdateIdea,
  getIdea: mockGetIdea,
}))

vi.mock('../../../../src/L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
}))

import { runIdeaUpdate, runIdeaGet } from '../../../../src/L7-app/commands/ideaUpdate.js'

const mockIdea = {
  issueNumber: 42,
  issueUrl: 'https://github.com/owner/repo/issues/42',
  repoFullName: 'owner/repo',
  id: 'idea-42',
  topic: 'Test Idea',
  hook: 'Test Hook',
  audience: 'developers',
  keyTakeaway: 'Key takeaway',
  talkingPoints: ['point 1'],
  platforms: ['youtube'],
  status: 'draft',
  tags: ['test'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  publishBy: '2026-02-01',
}

describe('L7 Unit: idea update command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateIdea.mockResolvedValue(mockIdea)
    mockGetIdea.mockResolvedValue(mockIdea)
    process.exitCode = undefined
  })

  // runIdeaUpdate tests
  it('updates idea with topic', async () => {
    await runIdeaUpdate('42', { topic: 'New Topic' })
    expect(mockUpdateIdea).toHaveBeenCalledWith(42, expect.objectContaining({ topic: 'New Topic' }))
  })

  it('updates idea with status', async () => {
    await runIdeaUpdate('42', { status: 'ready' })
    expect(mockUpdateIdea).toHaveBeenCalledWith(42, expect.objectContaining({ status: 'ready' }))
  })

  it('updates idea with urgency hot', async () => {
    await runIdeaUpdate('42', { urgency: 'hot' })
    expect(mockUpdateIdea).toHaveBeenCalledWith(42, expect.objectContaining({
      publishBy: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }))
  })

  it('updates idea with urgency urgent', async () => {
    await runIdeaUpdate('42', { urgency: 'urgent' })
    expect(mockUpdateIdea).toHaveBeenCalledWith(42, expect.objectContaining({ publishBy: expect.any(String) }))
  })

  it('updates idea with urgency soon', async () => {
    await runIdeaUpdate('42', { urgency: 'soon' })
    expect(mockUpdateIdea).toHaveBeenCalledWith(42, expect.objectContaining({ publishBy: expect.any(String) }))
  })

  it('updates idea with urgency flexible', async () => {
    await runIdeaUpdate('42', { urgency: 'flexible' })
    expect(mockUpdateIdea).toHaveBeenCalledWith(42, expect.objectContaining({ publishBy: expect.any(String) }))
  })

  it('updates idea with platforms', async () => {
    await runIdeaUpdate('42', { platforms: 'youtube,tiktok' })
    expect(mockUpdateIdea).toHaveBeenCalledWith(42, expect.objectContaining({
      platforms: expect.arrayContaining(['youtube', 'tiktok']),
    }))
  })

  it('updates idea with tags', async () => {
    await runIdeaUpdate('42', { tags: 'ai,copilot' })
    expect(mockUpdateIdea).toHaveBeenCalledWith(42, expect.objectContaining({
      tags: ['ai', 'copilot'],
    }))
  })

  it('updates idea with talking points', async () => {
    await runIdeaUpdate('42', { talkingPoints: 'point A,point B' })
    expect(mockUpdateIdea).toHaveBeenCalledWith(42, expect.objectContaining({
      talkingPoints: ['point A', 'point B'],
    }))
  })

  it('updates idea with publish-by date', async () => {
    await runIdeaUpdate('42', { publishBy: '2026-06-01' })
    expect(mockUpdateIdea).toHaveBeenCalledWith(42, expect.objectContaining({ publishBy: '2026-06-01' }))
  })

  it('updates idea with multiple fields', async () => {
    await runIdeaUpdate('42', { topic: 'New', status: 'ready', urgency: 'hot' })
    expect(mockUpdateIdea).toHaveBeenCalledWith(42, expect.objectContaining({
      topic: 'New',
      status: 'ready',
      publishBy: expect.any(String),
    }))
  })

  it('rejects invalid issue number', async () => {
    await runIdeaUpdate('abc', { topic: 'X' })
    expect(process.exitCode).toBe(1)
    expect(mockUpdateIdea).not.toHaveBeenCalled()
  })

  it('rejects invalid status', async () => {
    await runIdeaUpdate('42', { status: 'invalid' })
    expect(process.exitCode).toBe(1)
    expect(mockUpdateIdea).not.toHaveBeenCalled()
  })

  it('rejects invalid urgency', async () => {
    await runIdeaUpdate('42', { urgency: 'extreme' })
    expect(process.exitCode).toBe(1)
    expect(mockUpdateIdea).not.toHaveBeenCalled()
  })

  it('rejects no updates', async () => {
    await runIdeaUpdate('42', {})
    expect(process.exitCode).toBe(1)
    expect(mockUpdateIdea).not.toHaveBeenCalled()
  })

  it('handles update error', async () => {
    mockUpdateIdea.mockRejectedValue(new Error('Not found'))
    await runIdeaUpdate('42', { topic: 'X' })
    expect(process.exitCode).toBe(1)
  })

  // runIdeaGet tests
  it('displays idea details', async () => {
    await runIdeaGet('42')
    expect(mockGetIdea).toHaveBeenCalledWith(42)
  })

  it('rejects invalid issue number for get', async () => {
    await runIdeaGet('abc')
    expect(process.exitCode).toBe(1)
    expect(mockGetIdea).not.toHaveBeenCalled()
  })

  it('handles idea not found', async () => {
    mockGetIdea.mockResolvedValue(null)
    await runIdeaGet('99')
    expect(process.exitCode).toBe(1)
  })

  it('handles get error', async () => {
    mockGetIdea.mockRejectedValue(new Error('API error'))
    await runIdeaGet('42')
    expect(process.exitCode).toBe(1)
  })
})
