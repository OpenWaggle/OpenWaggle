import { describe, expect, it } from 'vitest'
import {
  BROWSER_PREVIEW_FLOATING_EDGE_GAP,
  clampBrowserPreviewFloatingPosition,
  clampBrowserPreviewFloatingSize,
  FLOATING_FRAME_CHROME,
  type FloatingResizeDirection,
  fitBrowserPreviewFloatingFrame,
  resizeBrowserPreviewFloatingFrame,
} from '../browser-preview-floating-layout'

describe('browser preview floating layout', () => {
  it('keeps a dragged preview inside the conversation viewport', () => {
    expect(
      clampBrowserPreviewFloatingPosition(
        { x: 900, y: -40 },
        { width: 1_000, height: 700 },
        { width: 320, height: 200 },
      ),
    ).toEqual({ x: 668, y: BROWSER_PREVIEW_FLOATING_EDGE_GAP })
  })

  it('uses the 240 by 150 minimum when space permits', () => {
    expect(
      clampBrowserPreviewFloatingSize({ width: 20, height: 30 }, { width: 1_000, height: 700 }),
    ).toEqual({ width: 240, height: 150 })
  })

  it('lets a small conversation viewport override the preferred minimum', () => {
    expect(
      clampBrowserPreviewFloatingSize({ width: 320, height: 200 }, { width: 220, height: 140 }),
    ).toEqual({ width: 196, height: 116 })
  })

  it('normalizes non-finite geometry to a safe edge-aligned layout', () => {
    expect(
      clampBrowserPreviewFloatingPosition(
        { x: Number.NaN, y: Number.POSITIVE_INFINITY },
        { width: 1_000, height: 700 },
        { width: 320, height: 200 },
      ),
    ).toEqual({ x: BROWSER_PREVIEW_FLOATING_EDGE_GAP, y: BROWSER_PREVIEW_FLOATING_EDGE_GAP })
  })

  it('preserves the content aspect ratio and original size across a temporary container shrink', () => {
    const desired = { width: 600, height: 400 }
    const source = { width: 1280, height: 800 }
    const large = { width: 1000, height: 800 }
    const initial = fitBrowserPreviewFloatingFrame(desired, null, large, source)
    const small = fitBrowserPreviewFloatingFrame(desired, null, { width: 300, height: 240 }, source)
    expect(initial.width).toBe(600)
    expect(small.width).toBeLessThan(initial.width)
    expect(
      (small.width - FLOATING_FRAME_CHROME.width) / (small.height - FLOATING_FRAME_CHROME.height),
    ).toBeCloseTo(1.6)
    expect(fitBrowserPreviewFloatingFrame(desired, null, large, source)).toEqual(initial)
  })

  it.each([
    'north',
    'south',
    'east',
    'west',
    'northeast',
    'northwest',
    'southeast',
    'southwest',
  ] satisfies FloatingResizeDirection[])(
    'resizes from %s while retaining the opposite anchor and content proportions',
    (direction) => {
      const source = { width: 1280, height: 800 }
      const container = { width: 1600, height: 1000 }
      const original = fitBrowserPreviewFloatingFrame(
        { width: 400, height: 300 },
        { x: 400, y: 300 },
        container,
        source,
      )
      const next = resizeBrowserPreviewFloatingFrame(
        original,
        direction,
        {
          x: direction.includes('west') ? -20 : 20,
          y: direction.includes('north') ? -20 : 20,
        },
        container,
        source,
      )
      expect(next.width).toBeGreaterThan(original.width)
      expect(
        (next.width - FLOATING_FRAME_CHROME.width) / (next.height - FLOATING_FRAME_CHROME.height),
      ).toBeCloseTo(1.6)
      expect(direction.includes('west') ? next.x + next.width : next.x).toBeCloseTo(
        direction.includes('west') ? original.x + original.width : original.x,
        0,
      )
      expect(direction.includes('north') ? next.y + next.height : next.y).toBeCloseTo(
        direction.includes('north') ? original.y + original.height : original.y,
        0,
      )
    },
  )

  it('never enlarges beyond source resolution and keeps an edge-constrained resize inside chat', () => {
    const source = { width: 800, height: 600 }
    const container = { width: 1000, height: 800 }
    const origin = fitBrowserPreviewFloatingFrame(
      { width: 400, height: 300 },
      { x: 500, y: 400 },
      container,
      source,
    )
    const next = resizeBrowserPreviewFloatingFrame(
      origin,
      'southeast',
      { x: 10_000, y: 10_000 },
      container,
      source,
    )
    expect(next.width - FLOATING_FRAME_CHROME.width).toBeLessThanOrEqual(source.width)
    expect(next.x + next.width).toBeLessThanOrEqual(
      container.width - BROWSER_PREVIEW_FLOATING_EDGE_GAP,
    )
    expect(next.y + next.height).toBeLessThanOrEqual(
      container.height - BROWSER_PREVIEW_FLOATING_EDGE_GAP,
    )
  })
})
