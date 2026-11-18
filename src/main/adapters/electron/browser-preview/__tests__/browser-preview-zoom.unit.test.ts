import { describe, expect, it } from 'vitest'
import { nextBrowserPreviewZoomFactor } from '../browser-preview-zoom'

describe('nextBrowserPreviewZoomFactor', () => {
  it('steps on tenths and resets to one', () => {
    expect(nextBrowserPreviewZoomFactor(1, 'in')).toBe(1.1)
    expect(nextBrowserPreviewZoomFactor(1.1, 'out')).toBe(1)
    expect(nextBrowserPreviewZoomFactor(2.4, 'reset')).toBe(1)
  })

  it('clamps zoom to the native preview range', () => {
    expect(nextBrowserPreviewZoomFactor(5, 'in')).toBe(5)
    expect(nextBrowserPreviewZoomFactor(0.25, 'out')).toBe(0.25)
  })
})
