import { describe, expect, it } from 'vitest'
import { shouldPurgeVisualizationFramesForNavigation } from '../inline-visualization-owner-lifecycle'

describe('inline visualization owner lifecycle', () => {
  it('keeps registrations across hash routing and purges real document changes', () => {
    expect(
      shouldPurgeVisualizationFramesForNavigation({
        isMainFrame: true,
        isSameDocument: true,
      }),
    ).toBe(false)
    expect(
      shouldPurgeVisualizationFramesForNavigation({
        isMainFrame: false,
        isSameDocument: false,
      }),
    ).toBe(false)
    expect(
      shouldPurgeVisualizationFramesForNavigation({
        isMainFrame: true,
        isSameDocument: false,
      }),
    ).toBe(true)
  })
})
