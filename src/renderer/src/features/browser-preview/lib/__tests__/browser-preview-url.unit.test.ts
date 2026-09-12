import { describe, expect, it } from 'vitest'
import { normalizeBrowserPreviewUrl } from '../browser-preview-url'

describe('normalizeBrowserPreviewUrl', () => {
  it('keeps explicit http(s) URLs canonical', () => {
    expect(normalizeBrowserPreviewUrl(' https://example.com/docs ')).toBe(
      'https://example.com/docs',
    )
    expect(normalizeBrowserPreviewUrl('http://localhost:5173')).toBe('http://localhost:5173/')
  })

  it('uses http for local development and https for public hostnames', () => {
    expect(normalizeBrowserPreviewUrl('localhost:3000/app')).toBe('http://localhost:3000/app')
    expect(normalizeBrowserPreviewUrl('example.com/docs')).toBe('https://example.com/docs')
  })

  it('rejects non-web schemes, invalid input, and oversized addresses', () => {
    expect(normalizeBrowserPreviewUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeBrowserPreviewUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeBrowserPreviewUrl('https://user:secret@example.com/')).toBeNull()
    expect(normalizeBrowserPreviewUrl('not a host')).toBeNull()
    expect(normalizeBrowserPreviewUrl(`https://example.com/${'x'.repeat(9_000)}`)).toBeNull()
  })
})
