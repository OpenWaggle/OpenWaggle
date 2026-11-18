import { describe, expect, it } from 'vitest'
import {
  assertBrowserPreviewActionOutcome,
  boundedBrowserPreviewAccessibilityTree,
  decodeBrowserPreviewClickPoint,
  decodeBrowserPreviewPageSnapshot,
  decodeBrowserPreviewViewport,
  decodeBrowserPreviewWaitMatch,
} from '../browser-preview-automation-page-results'

describe('browser preview automation page results', () => {
  it('decodes trusted page and viewport data at the CDP boundary', () => {
    const snapshot = {
      url: 'http://localhost:3000/',
      title: 'Home',
      loading: false,
      visibleText: 'Ready',
      interactiveElements: [
        {
          tag: 'button',
          role: 'button',
          name: 'Continue',
          selector: '#continue',
          x: 10,
          y: 20,
          width: 100,
          height: 40,
        },
      ],
    }

    expect(decodeBrowserPreviewPageSnapshot(snapshot)).toEqual(snapshot)
    expect(decodeBrowserPreviewViewport({ width: 1_280, height: 720 })).toEqual({
      width: 1_280,
      height: 720,
    })
  })

  it('rejects malformed page values instead of trusting page JavaScript', () => {
    expect(() =>
      decodeBrowserPreviewPageSnapshot({
        url: 'http://localhost:3000/',
        title: 'Home',
        loading: 'complete',
        visibleText: 'Ready',
        interactiveElements: [],
      }),
    ).toThrow('malformed page snapshot data')
    expect(() => decodeBrowserPreviewViewport({ width: 'wide', height: 720 })).toThrow(
      'malformed viewport data',
    )
  })

  it('maps action, point, and wait outcomes to stable results and errors', () => {
    expect(decodeBrowserPreviewClickPoint({ kind: 'point', x: 12, y: 24 })).toEqual({
      x: 12,
      y: 24,
    })
    expect(decodeBrowserPreviewWaitMatch({ kind: 'match', matched: true })).toBe(true)
    expect(assertBrowserPreviewActionOutcome({ kind: 'ok' })).toBeUndefined()

    expect(() => decodeBrowserPreviewClickPoint({ kind: 'not-found' })).toThrow(
      'not found or was not actionable',
    )
    expect(() => assertBrowserPreviewActionOutcome({ kind: 'not-editable' })).toThrow(
      'not editable',
    )
    expect(() =>
      decodeBrowserPreviewWaitMatch({ kind: 'invalid-selector', message: 'bad selector' }),
    ).toThrow('bad selector')
  })

  it('bounds accessibility snapshots while preserving non-tree responses', () => {
    const nodes = Array.from({ length: 513 }, (_, index) => ({ nodeId: String(index) }))

    expect(boundedBrowserPreviewAccessibilityTree({ nodes })).toEqual({
      nodes: nodes.slice(0, 512),
      truncated: true,
    })
    expect(boundedBrowserPreviewAccessibilityTree('unavailable')).toBe('unavailable')
  })
})
