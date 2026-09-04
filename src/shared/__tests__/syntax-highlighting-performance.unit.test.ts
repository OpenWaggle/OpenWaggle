import { describe, expect, it } from 'vitest'
import {
  analyzeSourceForView,
  MAX_COMPACT_SYNTAX_LINE_COUNT,
  MAX_COMPACT_SYNTAX_SOURCE_CODE_UNITS,
  shouldVirtualizeSyntaxSource,
  sourceViewLineAt,
  syntaxSourceFingerprint,
} from '../syntax-highlighting-performance'

describe('syntax rendering performance policy', () => {
  it('keeps compact snippets on the low-overhead renderer', () => {
    expect(shouldVirtualizeSyntaxSource('const value = 42')).toBe(false)
  })

  it('virtualizes sources that exceed either compact rendering boundary', () => {
    expect(shouldVirtualizeSyntaxSource('x'.repeat(MAX_COMPACT_SYNTAX_SOURCE_CODE_UNITS + 1))).toBe(
      true,
    )
    expect(shouldVirtualizeSyntaxSource('x\n'.repeat(MAX_COMPACT_SYNTAX_LINE_COUNT + 1))).toBe(true)
  })

  it('returns a stable fingerprint for viewport source identity', () => {
    expect(syntaxSourceFingerprint('const value = 42')).toBe(
      syntaxSourceFingerprint('const value = 42'),
    )
    expect(syntaxSourceFingerprint('const value = 42')).not.toBe(
      syntaxSourceFingerprint('const value = 43'),
    )
  })

  it('indexes source lines and fingerprints admitted sources in one analysis', () => {
    const source = 'first\nsecond\n'
    const analysis = analyzeSourceForView(source)

    expect(analysis.admission).toEqual({ admitted: true })
    expect(analysis.sourceFingerprint).toBe(syntaxSourceFingerprint(source))
    expect(analysis.lineStarts).toEqual([0, 6, 13])
    expect(
      analysis.lineStarts.map((_, index) => sourceViewLineAt(source, analysis.lineStarts, index)),
    ).toEqual(['first', 'second', ''])
  })

  it('still indexes rejected sources without spending work on a fingerprint', () => {
    const source = `${'x'.repeat(MAX_COMPACT_SYNTAX_SOURCE_CODE_UNITS)}\n${'y'.repeat(
      MAX_COMPACT_SYNTAX_SOURCE_CODE_UNITS,
    )}`
    const analysis = analyzeSourceForView(source)

    expect(analysis.admission.admitted).toBe(false)
    expect(analysis.sourceFingerprint).toBe('')
    expect(sourceViewLineAt(source, analysis.lineStarts, 1)).toHaveLength(
      MAX_COMPACT_SYNTAX_SOURCE_CODE_UNITS,
    )
  })
})
