import { describe, it, expect, beforeEach } from 'vitest'
import { costTracker } from '../services/costTracker.js'

describe('CostTracker service costs', () => {
  beforeEach(() => {
    costTracker.reset()
  })

  it('recordServiceUsage records service usage', () => {
    costTracker.setStage('transcription')
    costTracker.recordServiceUsage('whisper', 0.0252, { durationSeconds: 252 })

    const report = costTracker.getReport()

    expect(report.serviceRecords).toHaveLength(1)
    expect(report.serviceRecords[0].service).toBe('whisper')
    expect(report.serviceRecords[0].stage).toBe('transcription')
    expect(report.serviceRecords[0].costUSD).toBe(0.0252)
    expect(report.serviceRecords[0].metadata).toEqual({ durationSeconds: 252 })
    expect(report.totalServiceCostUSD).toBe(0.0252)
    expect(report.byService.whisper.costUSD).toBe(0.0252)
    expect(report.byService.whisper.calls).toBe(1)
  })

  it('service costs included in totalCostUSD', () => {
    costTracker.recordUsage('openai', 'gpt-4o', { inputTokens: 100, outputTokens: 50, totalTokens: 150 })
    costTracker.recordServiceUsage('whisper', 0.05)

    const report = costTracker.getReport()

    // totalCostUSD should include both LLM cost and service cost
    expect(report.totalCostUSD).toBeGreaterThan(report.totalServiceCostUSD)
    expect(report.totalServiceCostUSD).toBe(0.05)
    // LLM cost alone (totalCostUSD minus service cost) should be > 0
    expect(report.totalCostUSD - report.totalServiceCostUSD).toBeGreaterThan(0)
  })

  it('multiple service records aggregate correctly', () => {
    costTracker.setStage('transcription')
    costTracker.recordServiceUsage('whisper', 0.03, { durationSeconds: 300 })

    costTracker.setStage('social-media')
    costTracker.recordServiceUsage('exa', 0.001)
    costTracker.recordServiceUsage('exa', 0.001)
    costTracker.recordServiceUsage('exa', 0.001)

    const report = costTracker.getReport()

    expect(report.serviceRecords).toHaveLength(4)
    expect(report.byService.whisper.costUSD).toBe(0.03)
    expect(report.byService.whisper.calls).toBe(1)
    expect(report.byService.exa.costUSD).toBeCloseTo(0.003)
    expect(report.byService.exa.calls).toBe(3)
    expect(report.totalServiceCostUSD).toBeCloseTo(0.033)
  })

  it('reset clears service records', () => {
    costTracker.recordServiceUsage('whisper', 0.05)
    costTracker.recordServiceUsage('exa', 0.001)

    costTracker.reset()

    const report = costTracker.getReport()
    expect(report.serviceRecords).toHaveLength(0)
    expect(report.totalServiceCostUSD).toBe(0)
    expect(report.byService).toEqual({})
  })

  it('formatReport includes service section', () => {
    costTracker.setStage('transcription')
    costTracker.recordServiceUsage('whisper', 0.0252, { durationSeconds: 252 })

    const output = costTracker.formatReport()

    expect(output).toContain('By Service:')
    expect(output).toContain('whisper')
  })
})
