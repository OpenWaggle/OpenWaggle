import { describe, expect, it } from 'vitest'
import { isShippedPath, timingDecision } from '../changed-paths'

describe('what the timing job measures', () => {
  it('skips a change to docs, the website or the agent instructions only', () => {
    expect(
      timingDecision([
        'docs/adr/0001.md',
        'website/src/pages/index.astro',
        '.agents/memory/performance.md',
        'README.md',
      ]),
    ).toEqual({
      run: false,
      reason: 'no shipped code changed',
    })
  })

  it('times a change to anything else, including the gate, shipped notices and unknown paths', () => {
    expect(isShippedPath('src/main/index.ts')).toBe(true)
    expect(isShippedPath('THIRD_PARTY_NOTICES.md')).toBe(true)
    expect(isShippedPath('.github/workflows/perf-gate.yml')).toBe(true)
    expect(isShippedPath('docs-extra/file.md')).toBe(true)
    expect(isShippedPath('website')).toBe(true)
    expect(timingDecision(['docs/a.md', 'package.json'])).toEqual({
      run: true,
      reason: '1 shipped file(s) changed, e.g. package.json',
    })
  })
})
