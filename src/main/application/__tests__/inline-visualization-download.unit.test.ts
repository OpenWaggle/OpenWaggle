import { describe, expect, it } from 'vitest'
import { decodeInlineVisualizationDownload } from '../inline-visualization-download'

describe('inline visualization download', () => {
  it('decodes bounded base64 and strips path authority from the suggested name', () => {
    const contents = Buffer.from('local export', 'utf8')

    expect(
      decodeInlineVisualizationDownload({
        suggestedName: '..\\../report.txt',
        mimeType: 'text/plain',
        base64Data: contents.toString('base64'),
      }),
    ).toEqual({ contents, suggestedName: 'report.txt' })
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
