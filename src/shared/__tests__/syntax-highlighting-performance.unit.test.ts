import { describe, expect, it } from 'vitest'
import {
  MAX_COMPACT_SYNTAX_LINE_COUNT,
  MAX_COMPACT_SYNTAX_SOURCE_CODE_UNITS,
  shouldVirtualizeSyntaxSource,
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
})
