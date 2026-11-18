import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BROWSER_PREVIEW_VIEWPORT_COMMIT_TIMEOUT_MS,
  BrowserPreviewViewportCommitTimeoutError,
  browserPreviewViewportKey,
  commitBrowserPreviewViewportChange,
  resizeBrowserPreviewViewport,
  resizeBrowserPreviewViewportFromRail,
} from '../browser-preview-viewport-actions'

const FIXED_VIEWPORT = {
  mode: 'fixed',
  width: 800,
  height: 600,
  presetId: null,
} as const

afterEach(() => vi.useRealTimers())

describe('browser preview viewport resize actions', () => {
  it('keys fill, preset, and freeform dimensions without collisions', () => {
    expect(browserPreviewViewportKey({ mode: 'fill' })).toBe('fill')
    expect(
      browserPreviewViewportKey({
        mode: 'fixed',
        width: 390,
        height: 844,
        presetId: 'iphone-12-pro',
      }),
    ).toBe('fixed:390:844:iphone-12-pro')
    expect(browserPreviewViewportKey(FIXED_VIEWPORT)).toBe('fixed:800:600:')
  })

  it.each([
    ['east', { x: 20, y: 500 }, { width: 810, height: 600 }],
    ['west', { x: -20, y: 500 }, { width: 810, height: 600 }],
    ['south', { x: 500, y: 20 }, { width: 800, height: 610 }],
    ['southwest', { x: -20, y: 20 }, { width: 810, height: 610 }],
    ['southeast', { x: 20, y: 20 }, { width: 810, height: 610 }],
  ] as const)(
    'resizes the %s axes through the current visual scale',
    (direction, delta, expected) => {
      expect(resizeBrowserPreviewViewport(FIXED_VIEWPORT, delta, 2, direction)).toEqual(expected)
    },
  )

  it('clamps dimensions and total area at the shared boundary', () => {
    expect(
      resizeBrowserPreviewViewport({ width: 240, height: 240 }, { x: -1_000, y: -1_000 }),
    ).toEqual({ width: 240, height: 240 })
    const bounded = resizeBrowserPreviewViewport(
      { width: 3_840, height: 2_160 },
      { x: 1_000, y: 1_000 },
    )
    expect(bounded.width * bounded.height).toBeLessThanOrEqual(3_840 * 2_160)
    expect(bounded.width).toBeGreaterThanOrEqual(240)
    expect(bounded.height).toBeGreaterThanOrEqual(240)
  })

  it('holds a locked aspect ratio on either controlled axis', () => {
    expect(
      resizeBrowserPreviewViewport({ width: 400, height: 300 }, { x: 400, y: 0 }, 1, 'east', 4 / 3),
    ).toEqual({ width: 800, height: 600 })
    expect(
      resizeBrowserPreviewViewport(
        { width: 400, height: 300 },
        { x: 0, y: 300 },
        1,
        'south',
        4 / 3,
      ),
    ).toEqual({ width: 800, height: 600 })
  })

  it.each([
    ['east', { x: 50, y: 0 }, { width: 700, height: 400 }],
    ['west', { x: -50, y: 0 }, { width: 700, height: 400 }],
    ['south', { x: 0, y: 50 }, { width: 600, height: 500 }],
    ['southwest', { x: -50, y: 50 }, { width: 700, height: 500 }],
    ['southeast', { x: 50, y: 50 }, { width: 700, height: 500 }],
  ] as const)(
    'maps the centered %s rail to the matching CSS dimensions',
    (direction, delta, expected) => {
      expect(
        resizeBrowserPreviewViewportFromRail(
          { width: 600, height: 400 },
          delta,
          { width: 1_000, height: 800 },
          1,
          direction,
        ),
      ).toEqual(expected)
    },
  )
})

describe('browser preview viewport commit queue', () => {
  it('serializes commits for one preview while allowing another preview through', async () => {
    const firstGate = Promise.withResolvers<void>()
    const calls: string[] = []
    const first = commitBrowserPreviewViewportChange('preview-a', FIXED_VIEWPORT, async () => {
      calls.push('a:first')
      await firstGate.promise
    })
    const second = commitBrowserPreviewViewportChange('preview-a', FIXED_VIEWPORT, async () => {
      calls.push('a:second')
    })
    const independent = commitBrowserPreviewViewportChange(
      'preview-b',
      FIXED_VIEWPORT,
      async () => {
        calls.push('b:first')
      },
    )

    await independent
    expect(calls).toEqual(['a:first', 'b:first'])
    firstGate.resolve()
    await Promise.all([first, second])
    expect(calls).toEqual(['a:first', 'b:first', 'a:second'])
  })

  it('starts its timeout only after a queued commit reaches the front', async () => {
    vi.useFakeTimers()
    const firstGate = Promise.withResolvers<void>()
    const first = commitBrowserPreviewViewportChange(
      'preview-timeout-order',
      FIXED_VIEWPORT,
      () => firstGate.promise,
    )
    const second = commitBrowserPreviewViewportChange(
      'preview-timeout-order',
      FIXED_VIEWPORT,
      async () => undefined,
    )
    await vi.advanceTimersByTimeAsync(BROWSER_PREVIEW_VIEWPORT_COMMIT_TIMEOUT_MS - 1)

    firstGate.resolve()
    await first
    await second
  })

  it('rejects a caller-facing commit that stalls after it starts', async () => {
    vi.useFakeTimers()
    const stalled = commitBrowserPreviewViewportChange(
      'preview-stalled',
      FIXED_VIEWPORT,
      () => new Promise<void>(() => undefined),
    )
    const rejection = expect(stalled).rejects.toBeInstanceOf(
      BrowserPreviewViewportCommitTimeoutError,
    )
    await vi.advanceTimersByTimeAsync(BROWSER_PREVIEW_VIEWPORT_COMMIT_TIMEOUT_MS)
    await rejection
  })
})
