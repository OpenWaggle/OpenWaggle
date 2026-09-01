import { describe, expect, it } from 'vitest'
import {
  MAX_SYNTAX_LINE_CODE_UNITS,
  MAX_SYNTAX_LINE_COUNT,
  MAX_SYNTAX_SOURCE_CODE_UNITS,
  syntaxHighlightAdmission,
} from '../syntax-admission'

describe('syntax highlight admission', () => {
  it('admits representative source within every rendering budget', () => {
    expect(syntaxHighlightAdmission('const answer = 42\n')).toEqual({ admitted: true })
  })

  it('rejects oversized source before it reaches a worker', () => {
    expect(syntaxHighlightAdmission('x'.repeat(MAX_SYNTAX_SOURCE_CODE_UNITS + 1))).toMatchObject({
      admitted: false,
      diagnostic: expect.stringContaining('1 MiB'),
    })
  })

  it('rejects pathological line counts and line lengths', () => {
    expect(syntaxHighlightAdmission('\n'.repeat(MAX_SYNTAX_LINE_COUNT))).toMatchObject({
      admitted: false,
      diagnostic: expect.stringContaining('50,000-line'),
    })
    expect(syntaxHighlightAdmission('x'.repeat(MAX_SYNTAX_LINE_CODE_UNITS + 1))).toMatchObject({
      admitted: false,
      diagnostic: expect.stringContaining('50,000 characters'),
    })
  })
})
