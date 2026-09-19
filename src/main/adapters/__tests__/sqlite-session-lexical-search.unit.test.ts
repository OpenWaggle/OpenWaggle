import { describe, expect, it } from 'vitest'
import { lexicalFtsQuery } from '../sqlite-session-lexical-search'

describe('lexical Session search', () => {
  it('normalizes quoted empty input without producing an invalid FTS expression', () => {
    expect(() => lexicalFtsQuery('""')).toThrow('at least one searchable term')
  })

  it('quotes terms and preserves explicit phrase searches', () => {
    expect(lexicalFtsQuery('alpha beta')).toBe('"alpha" AND "beta"')
    expect(lexicalFtsQuery('"alpha beta"')).toBe('"alpha beta"')
  })
})
