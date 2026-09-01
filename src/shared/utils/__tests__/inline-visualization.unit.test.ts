import {
  extractInlineVisualizationReferences,
  inlineVisualizationFrameUrl,
  parseInlineVisualizationReference,
} from '@shared/utils/inline-visualization'
import { describe, expect, it } from 'vitest'

describe('inline visualization references', () => {
  it('keeps session and source identifiers out of the sandbox URL', () => {
    const frameUrl = inlineVisualizationFrameUrl('12345678-1234-4123-8123-123456789abc')

    expect(frameUrl).toBe(
      'openwaggle-visualization://frame-12345678-1234-4123-8123-123456789abc/document',
    )
    expect(new URL(frameUrl).search).toBe('')
  })

  it.each([
    'C:/Users/diego/visualizations/map.html',
    'C:\\Users\\diego\\visualizations\\map.html',
    '\\\\server\\share\\visualizations\\map.html',
    '//server/share/visualizations/map.html',
  ])('accepts the absolute Windows path form %s', (path) => {
    expect(parseInlineVisualizationReference(JSON.stringify({ path }))).toEqual({ path })
  })

  it('extracts only complete, strict references', () => {
    const first = '/tmp/first-map.html'
    const second = '/tmp/second-map.html'
    const text = [
      `visualize${JSON.stringify({ path: first })}`,
      'visualize{"path":"relative.html"}',
      `visualize${JSON.stringify({ path: second, mode: 'wide' })}`,
    ].join('\n')

    expect(extractInlineVisualizationReferences(text)).toEqual([
      { path: first },
      { path: second, mode: 'wide' },
    ])
  })
})
