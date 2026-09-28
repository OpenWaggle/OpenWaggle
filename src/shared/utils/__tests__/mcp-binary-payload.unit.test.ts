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

  it('accepts an image sent as a data URI and labels non-base64 image data neutrally', () => {
    const attached: string[] = []
    const sanitized = replaceMcpBinaryPayloads(
      [
        { type: 'image', data: `data:image/webp;base64,${PNG}`, mimeType: 'image/png' },
        { type: 'image', data: 'https://example.test/shot.png', mimeType: 'image/png' },
      ],
      {
        onImage: ({ data, mimeType }) => {
          attached.push(`${mimeType}:${data}`)
          return attached.length
        },
      },
    )

    expect(attached).toEqual([`image/webp:${PNG}`])
    expect(sanitized).toEqual([
      { type: 'image', data: '[image #1: image/webp]', mimeType: 'image/webp' },
      { type: 'image', data: '[image data omitted: 29 characters]', mimeType: 'image/png' },
    ])
  })

  it('treats upper-case base64 data URI markers and base64url blobs as binary', () => {
    const blob = 'aB3_-9Zz'.repeat(600)
    expect(replaceMcpBinaryPayloads(`see DATA:IMAGE/PNG;BASE64,${PNG} now`)).toBe(
      `see [image/png data URI omitted: ${String(`DATA:IMAGE/PNG;BASE64,${PNG}`.length)} characters] now`,
    )
    expect(replaceMcpBinaryPayloads(blob)).toBe(
      `[base64 data omitted: ${String(blob.length)} base64 characters]`,
    )
  })

  it('keeps the next line after an unpadded data URI', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAA'
    expect(replaceMcpBinaryPayloads(`Shot: ${dataUri}\nNext line here`)).toBe(
      `Shot: [image/png data URI omitted: ${String(dataUri.length)} characters]\nNext line here`,
    )
  })

  it('removes a line-wrapped data URI completely and keeps the prose after it', () => {
    const lines = Array.from({ length: 40 }, () => 'aB3+'.repeat(19))
    const dataUri = `data:image/png;base64,${lines.join('\n')}==`
    const sanitized = replaceMcpBinaryPayloads(`Shot: ${dataUri}\nDone with the capture`)

    expect(sanitized).toBe(
      `Shot: [image/png data URI omitted: ${String(dataUri.length)} characters]\nDone with the capture`,
    )
  })

  it('treats unpadded base64url blobs as binary', () => {
    const unpadded = `${'aB3_-9Zz'.repeat(600)}aB`
    expect(unpadded.length % 4).toBe(2)
    expect(replaceMcpBinaryPayloads(unpadded)).toBe(
      `[base64 data omitted: ${String(unpadded.length)} base64 characters]`,
    )
  })
})
