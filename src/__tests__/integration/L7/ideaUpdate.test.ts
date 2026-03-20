import { describe, test, expect, vi, beforeEach } from 'vitest'
// Integration test for idea update command

const mockUpdateIdea = vi.hoisted(() => vi.fn())
const mockGetIdea = vi.hoisted(() => vi.fn())

vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  updateIdea: mockUpdateIdea,
  getIdea: mockGetIdea,
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: vi.fn(),
}))

import { runIdeaUpdate, runIdeaGet } from '../../../L7-app/commands/ideaUpdate.js'

describe('idea update integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateIdea.mockResolvedValue({ issueNumber: 1, topic: 'Test', status: 'ready', publishBy: '2026-06-01', issueUrl: 'url' })
    mockGetIdea.mockResolvedValue({ issueNumber: 1, topic: 'Test', hook: 'Hook', audience: 'devs', keyTakeaway: 'Key', platforms: ['youtube'], tags: [], talkingPoints: [], status: 'draft', publishBy: '2026-06-01', issueUrl: 'url' })
    process.exitCode = undefined
  })

  test('update with urgency sets correct publish-by', async () => {
    await runIdeaUpdate('1', { urgency: 'hot', status: 'ready' })
    expect(mockUpdateIdea).toHaveBeenCalledWith(1, expect.objectContaining({
      status: 'ready',
      publishBy: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }))
  })

  test('get displays idea without error', async () => {
    await runIdeaGet('1')
    expect(mockGetIdea).toHaveBeenCalledWith(1)
    expect(process.exitCode).toBeUndefined()
  })

  test('update then get flow', async () => {
    await runIdeaUpdate('1', { topic: 'Updated' })
    await runIdeaGet('1')
    expect(mockUpdateIdea).toHaveBeenCalled()
    expect(mockGetIdea).toHaveBeenCalled()
  })
})
