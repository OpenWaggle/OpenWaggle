import { describe, expect, it } from 'vitest'
import { decodeInlineVisualizationDownload } from '../inline-visualization-download'

describe('inline visualization download', () => {
  it.each([
    ['path authority', '..\\../report.txt', 'report.txt'],
    ['control characters', 're\u0000po\u007fr\u0085t\n\u{1F600}.txt', 'report\u{1F600}.txt'],
    ['a name left empty', '\u0001\u0002', 'visualization-download'],
  ])('decodes bounded base64 and strips %s from the suggested name', (_case, name, expected) => {
    const contents = Buffer.from('local export', 'utf8')

    expect(
      decodeInlineVisualizationDownload({
        suggestedName: name,
        mimeType: 'text/plain',
        base64Data: contents.toString('base64'),
      }),
    ).toEqual({ contents, suggestedName: expected })
  })

  it('rejects malformed and oversized payloads', () => {
    expect(() =>
      decodeInlineVisualizationDownload({
        suggestedName: 'report.txt',
        mimeType: 'text/plain',
        base64Data: 'not base64!',
      }),
    ).toThrow('Invalid visualization download payload')
    expect(() =>
      decodeInlineVisualizationDownload({
        suggestedName: 'report.bin',
        mimeType: 'application/octet-stream',
        base64Data: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'),
      }),
    ).toThrow()
  })
})
