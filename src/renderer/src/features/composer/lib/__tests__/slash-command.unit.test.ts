import { describe, expect, it } from 'vitest'
import { findSlashCommandMatch, replaceSlashCommandMatch } from '../slash-command'

describe('slash command matching', () => {
  it('finds an inline query at the cursor and includes its remaining token suffix', () => {
    const text = 'Keep context /diag rest'

    expect(findSlashCommandMatch(text, 'Keep context /di'.length)).toEqual({
      query: 'diag',
      startOffset: 'Keep context '.length,
      endOffset: 'Keep context /diag'.length,
    })
  })

  it('supports extension command identifiers without matching path fragments', () => {
    expect(findSlashCommandMatch('Run /sample.slash', 'Run /sample.slash'.length)?.query).toBe(
      'sample.slash',
    )
    expect(findSlashCommandMatch('Inspect /tmp/repo', 'Inspect /tmp/repo'.length)).toBeNull()
  })

  it('replaces only the active token and preserves surrounding prompt text', () => {
    const text = 'Keep context /cav and continue'
    const match = findSlashCommandMatch(text, 'Keep context /cav'.length)
    if (!match) throw new Error('Expected slash command match')

    expect(replaceSlashCommandMatch(text, match, '/caveman', true)).toEqual({
      text: 'Keep context /caveman and continue',
      cursorOffset: 'Keep context /caveman'.length,
    })
  })

  it('consumes action triggers without leaving duplicate whitespace', () => {
    const text = 'Keep context /feedback after'
    const match = findSlashCommandMatch(text, 'Keep context /feedback'.length)
    if (!match) throw new Error('Expected slash command match')

    expect(replaceSlashCommandMatch(text, match, '', false)).toEqual({
      text: 'Keep context after',
      cursorOffset: 'Keep context '.length,
    })
  })
})
