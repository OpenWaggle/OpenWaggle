import {
  containsInlineVisualizationReference,
  extractInlineVisualizationReferences,
  inlineVisualizationFrameUrl,
  parseInlineVisualizationReference,
  VISUALIZE_REFERENCE_START,
  withholdUnresolvedVisualizationSuffix,
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

  it('extracts the delimiter-free own-line form emitted from the visible skill template', () => {
    const path = '/tmp/turn-settle-presentation.html'
    const text = [
      'Explanation before.',
      '',
      `visualize{"path":"${path}"}`,
      '',
      'Explanation after.',
    ].join('\n')

    expect(extractInlineVisualizationReferences(text)).toEqual([{ path }])
  })

  it('ignores delimiter-free references that are not alone on their line', () => {
    const text = 'See visualize{"path":"/tmp/map.html"} in the transcript.'

    expect(extractInlineVisualizationReferences(text)).toEqual([])
  })

  it('does not let an unterminated delimited marker hide a later bare reference', () => {
    const text = [
      `${VISUALIZE_REFERENCE_START}${JSON.stringify({ path: '/tmp/dangling.jsonl' })}`,
      'visualize{"path":"/tmp/after-dangling.html"}',
    ].join('\n')

    expect(extractInlineVisualizationReferences(text)).toEqual([
      { path: '/tmp/after-dangling.html' },
    ])
    expect(containsInlineVisualizationReference(text)).toBe(true)
  })

  it('rejects bare reference prose embedded in serialized content JSON', () => {
    const contentJson = JSON.stringify({
      parts: [{ type: 'text', text: 'See visualize{"path":"/tmp/map.html"} inline.' }],
    })

    expect(containsInlineVisualizationReference(contentJson)).toBe(false)
  })

  it('withholds a trailing partial bare line while streaming and renders a completed one', () => {
    expect(withholdUnresolvedVisualizationSuffix('Done.\n\nvisualize{"path":"/tmp/ma')).toBe(
      'Done.\n\n',
    )
    expect(
      withholdUnresolvedVisualizationSuffix('Done.\n\nvisualize{"path":"/tmp/map.html"}'),
    ).toBe('Done.\n\nvisualize{"path":"/tmp/map.html"}')
    expect(withholdUnresolvedVisualizationSuffix('No reference here.')).toBe('No reference here.')
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
