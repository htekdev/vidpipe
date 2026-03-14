import { describe, it, expect, vi } from 'vitest'

const mockGenerateIdeas = vi.hoisted(() => vi.fn())

vi.mock('../../../L5-assets/pipelineServices.js', () => ({
  generateIdeas: mockGenerateIdeas,
}))

describe('L6 Unit: ideation wrapper', () => {
  it('re-exports generateIdeas through the L6 wrapper', async () => {
    const expectedIdeas = [{ id: 'idea-1', title: 'Bridge ideation through L6' }]
    mockGenerateIdeas.mockResolvedValue(expectedIdeas)

    const { generateIdeas } = await import('../../../L6-pipeline/ideation.js')
    await expect(generateIdeas({ count: 3 })).resolves.toEqual(expectedIdeas)
    expect(mockGenerateIdeas).toHaveBeenCalledWith({ count: 3 })
  })
})
