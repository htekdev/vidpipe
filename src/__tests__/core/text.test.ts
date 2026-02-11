import { describe, it, expect } from 'vitest'
import { slugify, generateId } from '../../core/text.js'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('handles special characters', () => {
    const result = slugify('Foo & Bar!')
    expect(result).toMatch(/^foo.*bar$/)
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
})
