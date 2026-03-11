import { describe, it, expect } from 'vitest'
import { slugify, generateId } from '../../../L0-pure/text/text.js'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('handles special characters', () => {
    const result = slugify('Foo & Bar!')
    expect(result).toMatch(/^foo.*bar$/)
  })

  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('')
  })

  it('handles numbers in text', () => {
    expect(slugify('Video 123 Test')).toBe('video-123-test')
  })

  it('collapses multiple spaces into single hyphen', () => {
    expect(slugify('hello   world')).toBe('hello-world')
  })

  it('strips leading and trailing whitespace', () => {
    expect(slugify('  hello  ')).toBe('hello')
  })

  it('handles unicode characters', () => {
    const result = slugify('café résumé')
    expect(result).toBeTruthy()
    expect(result).not.toContain(' ')
  })

  it('respects custom replacement option', () => {
    const result = slugify('Hello World', { replacement: '_' })
    expect(result).toBe('hello_world')
  })

  it('respects lower: false option', () => {
    const result = slugify('Hello World', { lower: false })
    expect(result).toBe('Hello-World')
  })
})

describe('generateId', () => {
  it('returns UUID format (36 chars, dashes at correct positions)', () => {
    const id = generateId()
    expect(id).toHaveLength(36)
    expect(id[8]).toBe('-')
    expect(id[13]).toBe('-')
    expect(id[18]).toBe('-')
    expect(id[23]).toBe('-')
  })

  it('returns unique values on each call', () => {
    const id1 = generateId()
    const id2 = generateId()
    expect(id1).not.toBe(id2)
  })

  it('matches UUID v4 pattern', () => {
    const id = generateId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
