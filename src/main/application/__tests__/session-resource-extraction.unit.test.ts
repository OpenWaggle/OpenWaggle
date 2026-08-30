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
})
