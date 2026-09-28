import { describe, expect, it } from 'vitest'
import { normalizeMcpImageMimeType, replaceMcpBinaryPayloads } from '../mcp-binary-payload'

const PNG = 'iVBORw0KGgoAAAANSUhEUg'

describe('replaceMcpBinaryPayloads', () => {
  it('replaces binary payloads for draft text when no image sink is provided', () => {
    const sanitized = JSON.stringify(
      replaceMcpBinaryPayloads({
        content: [
          { type: 'text', text: 'App context' },
          { type: 'image', data: PNG, mimeType: 'image/png' },
          { type: 'audio', data: 'UklGRg==', mimeType: 'audio/wav' },
        ],
      }),
    )

    expect(sanitized).toContain('App context')
    expect(sanitized).not.toContain(PNG)
    expect(sanitized).not.toContain('UklGRg==')
    expect(sanitized).toContain(`[image data omitted: ${String(PNG.length)} base64 characters]`)
  })

  it('numbers each distinct image once and reuses the number for duplicates', () => {
    const attached: string[] = []
    const sanitized = replaceMcpBinaryPayloads(
      [
        { type: 'image', data: PNG, mimeType: 'image/png' },
        { type: 'image', data: `${PNG}AA`, mimeType: 'image/webp' },
        { type: 'image', data: PNG, mimeType: 'image/png' },
      ],
      {
        onImage: ({ data }) => {
          attached.push(data)
          return attached.length
        },
      },
    )

    expect(attached).toEqual([PNG, `${PNG}AA`])
    expect(sanitized).toEqual([
      { type: 'image', data: '[image #1: image/png]', mimeType: 'image/png' },
      { type: 'image', data: '[image #2: image/webp]', mimeType: 'image/webp' },
      { type: 'image', data: '[image #1: image/png]', mimeType: 'image/png' },
    ])
  })

  it('normalizes MIME types the way Pi accepts them for inline images', () => {
    expect(normalizeMcpImageMimeType('IMAGE/JPG; name=x')).toBe('image/jpeg')
    expect(normalizeMcpImageMimeType('image/png')).toBe('image/png')
    expect(normalizeMcpImageMimeType('image/svg+xml')).toBeNull()
  })
})
