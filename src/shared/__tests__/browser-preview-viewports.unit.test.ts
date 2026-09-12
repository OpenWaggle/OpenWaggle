import { describe, expect, it } from 'vitest'
import {
  BROWSER_PREVIEW_VIEWPORT_PRESETS,
  browserPreviewPresetViewport,
  isValidBrowserPreviewViewportSize,
  rotateBrowserPreviewViewport,
} from '../browser-preview-viewports'

describe('browser preview viewport catalog', () => {
  it('matches the Chrome-compatible preset order shipped by T3 Code', () => {
    expect(BROWSER_PREVIEW_VIEWPORT_PRESETS).toHaveLength(17)
    expect(BROWSER_PREVIEW_VIEWPORT_PRESETS[0]).toMatchObject({
      id: 'iphone-se',
      width: 375,
      height: 667,
    })
    expect(BROWSER_PREVIEW_VIEWPORT_PRESETS.at(-1)).toMatchObject({
      id: 'nest-hub-max',
      width: 1_280,
      height: 800,
    })
  })

  it('rotates portrait presets without losing their identity', () => {
    expect(browserPreviewPresetViewport('iphone-12-pro', 'landscape')).toEqual({
      mode: 'fixed',
      width: 844,
      height: 390,
      presetId: 'iphone-12-pro',
    })
  })

  it('enforces the selectable dimension and pixel-area bounds', () => {
    expect(isValidBrowserPreviewViewportSize(240, 240)).toBe(true)
    expect(isValidBrowserPreviewViewportSize(3_840, 2_160)).toBe(true)
    expect(isValidBrowserPreviewViewportSize(3_840, 3_840)).toBe(false)
    expect(isValidBrowserPreviewViewportSize(239, 800)).toBe(false)
  })

  it('rotates freeform viewports in place', () => {
    expect(
      rotateBrowserPreviewViewport({
        mode: 'fixed',
        width: 1_024,
        height: 768,
        presetId: null,
      }),
    ).toEqual({ mode: 'fixed', width: 768, height: 1_024, presetId: null })
  })
})
