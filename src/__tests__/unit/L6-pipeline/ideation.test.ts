import { describe, it, expect, vi } from 'vitest'

const mockGenerateIdeas = vi.hoisted(() => vi.fn())
const mockEnrichIdeaInput = vi.hoisted(() => vi.fn())

vi.mock('../../../L5-assets/pipelineServices.js', () => ({
  generateIdeas: mockGenerateIdeas,
  enrichIdeaInput: mockEnrichIdeaInput,
}))

describe('L6 Unit: ideation wrapper', () => {
  it('re-exports generateIdeas through the L6 wrapper', async () => {
    const expectedIdeas = [{ id: 'idea-1', title: 'Bridge ideation through L6' }]
    mockGenerateIdeas.mockResolvedValue(expectedIdeas)

    const { generateIdeas } = await import('../../../L6-pipeline/ideation.js')
    await expect(generateIdeas({ count: 3 })).resolves.toEqual(expectedIdeas)
    expect(mockGenerateIdeas).toHaveBeenCalledWith({ count: 3 })
  })

  it('re-exports enrichIdeaInput through the L6 wrapper', async () => {
    const enriched = { topic: 'Test', hook: 'Hook', audience: 'devs', keyTakeaway: 'k', talkingPoints: [], platforms: ['youtube'], tags: [], publishBy: '2026-04-01' }
    mockEnrichIdeaInput.mockResolvedValue(enriched)

    const { enrichIdeaInput } = await import('../../../L6-pipeline/ideation.js')
    await expect(enrichIdeaInput('Test', 'prompt')).resolves.toEqual(enriched)
    expect(mockEnrichIdeaInput).toHaveBeenCalledWith('Test', 'prompt')
  })
})
