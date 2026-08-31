import { describe, expect, it } from 'vitest'
import {
  collectExplicitResources,
  SESSION_RESOURCE_EXTRACTION_LIMITS,
} from '../session-resource-extraction'
import { PNG_BASE64 } from './session-resource-capture.fixtures'

describe('session resource extraction limits', () => {
  it('caps eager image and Markdown-link collection', () => {
    const images = Array.from(
      { length: SESSION_RESOURCE_EXTRACTION_LIMITS.maxImages + 20 },
      (_, index) => ({
        type: 'image',
        data: PNG_BASE64,
        mimeType: 'image/png',
        name: `Image ${String(index)}`,
      }),
    )
    const markdown = Array.from(
      { length: SESSION_RESOURCE_EXTRACTION_LIMITS.maxLinks + 20 },
      (_, index) => `[Link ${String(index)}](https://example.test/${String(index)})`,
    ).join('\n')

    const extracted = collectExplicitResources({ images, markdown })

    expect(extracted.images).toHaveLength(SESSION_RESOURCE_EXTRACTION_LIMITS.maxImages)
    expect(extracted.links).toHaveLength(SESSION_RESOURCE_EXTRACTION_LIMITS.maxLinks)
  })

  it('does not traverse array entries beyond the extraction node budget', () => {
    let accessedPastLimit = false
    const values = Array.from(
      { length: SESSION_RESOURCE_EXTRACTION_LIMITS.maxVisitedNodes + 20 },
      () => null,
    )
    Object.defineProperty(values, SESSION_RESOURCE_EXTRACTION_LIMITS.maxVisitedNodes + 1, {
      configurable: true,
      get: () => {
        accessedPastLimit = true
        return null
      },
    })

    collectExplicitResources(values)

    expect(accessedPastLimit).toBe(false)
  })

  it('keeps balanced parentheses in Markdown link destinations', () => {
    const extracted = collectExplicitResources(
      '[Function docs](https://example.test/Function_(math))',
    )

    expect(extracted.links).toEqual([
      {
        url: 'https://example.test/Function_(math)',
        title: 'https://example.test/Function_(math)',
        image: false,
      },
    ])
  })

  it('shares the text-character budget across every string in one payload', () => {
    const extracted = collectExplicitResources({
      first: 'x'.repeat(SESSION_RESOURCE_EXTRACTION_LIMITS.maxTextCharacters),
      second: '[Outside the budget](https://example.test/not-collected)',
    })

    expect(extracted.links).toEqual([])
  })

  it('collects rendered Markdown links but ignores code and escaped examples', () => {
    const extracted = collectExplicitResources(`
[Rendered docs](https://example.test/rendered)
\`[Inline example](https://example.test/inline-code)\`
\\[Escaped example](https://example.test/escaped)
\`\`\`md
[Fenced example](https://example.test/fenced-code)
\`\`\`
[Rendered image](https://example.test/rendered-image)
`)

    expect(extracted.links).toEqual([
      {
        url: 'https://example.test/rendered',
        title: 'https://example.test/rendered',
        image: false,
      },
      {
        url: 'https://example.test/rendered-image',
        title: 'https://example.test/rendered-image',
        image: false,
      },
    ])
  })
})
