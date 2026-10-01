import { describe, expect, it } from 'vitest'
import {
  GENERATED_SESSION_TITLE_MAX_LENGTH,
  parseGeneratedSessionTitle,
  sanitizeGeneratedSessionTitle,
} from '../session-title-output'

describe('parseGeneratedSessionTitle', () => {
  it('reads the requested JSON reply', () => {
    expect(
      parseGeneratedSessionTitle(
        '{"title":"Generate short session titles","needsRefinement":false}',
      ),
    ).toEqual({ title: 'Generate short session titles', needsRefinement: false })
  })

  it('keeps the refinement flag only when the model sets it', () => {
    expect(
      parseGeneratedSessionTitle('{"title":"Fix failing test","needsRefinement":true}'),
    ).toEqual({ title: 'Fix failing test', needsRefinement: true })
    expect(parseGeneratedSessionTitle('{"title":"Fix failing test"}')).toEqual({
      title: 'Fix failing test',
      needsRefinement: false,
    })
  })

  it('unwraps code fences and drops thinking blocks', () => {
    expect(
      parseGeneratedSessionTitle(
        '<think>The user wants titles.</think>\n```json\n{"title": "Sidebar title search"}\n```',
      ),
    ).toEqual({ title: 'Sidebar title search', needsRefinement: false })
  })

  it('accepts a bare title line', () => {
    expect(parseGeneratedSessionTitle('Title: "Rename sessions inline."\nExplanation')).toEqual({
      title: 'Rename sessions inline',
      needsRefinement: false,
    })
  })

  it('rejects empty, default, and malformed JSON replies', () => {
    expect(parseGeneratedSessionTitle('   ')).toBeNull()
    expect(parseGeneratedSessionTitle('{"title":"New session"}')).toBeNull()
    expect(parseGeneratedSessionTitle('{"title":"OpenWaggle session"}')).toBeNull()
    expect(parseGeneratedSessionTitle('{"title": ')).toBeNull()
    expect(parseGeneratedSessionTitle('{"name":"Wrong key"}')).toBeNull()
  })
})

describe('sanitizeGeneratedSessionTitle', () => {
  it('collapses whitespace and strips wrapping quotes and trailing punctuation', () => {
    expect(sanitizeGeneratedSessionTitle('  “Fix   the  sidebar”!! ')).toBe('Fix the sidebar')
  })

  it('bounds a runaway title at a word boundary', () => {
    const title = sanitizeGeneratedSessionTitle(`${'word '.repeat(40)}end`)
    expect(title?.length).toBeLessThanOrEqual(GENERATED_SESSION_TITLE_MAX_LENGTH)
    expect(title?.endsWith('...')).toBe(true)
    expect(title).not.toContain('wor...')
  })
})
