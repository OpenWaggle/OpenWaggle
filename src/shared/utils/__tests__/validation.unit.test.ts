import { describe, expect, it } from 'vitest'
import { isValidBaseUrl } from '../validation'

describe('isValidBaseUrl', () => {
  it('accepts valid http URLs', () => {
    expect(isValidBaseUrl('http://localhost:11434')).toBe(true)
    expect(isValidBaseUrl('http://example.com')).toBe(true)
    expect(isValidBaseUrl('http://192.168.1.1:8080')).toBe(true)
  })

  it('accepts valid https URLs', () => {
    expect(isValidBaseUrl('https://api.openai.com')).toBe(true)
    expect(isValidBaseUrl('https://api.anthropic.com/v1')).toBe(true)
  })

  it('rejects non-http protocols', () => {
    expect(isValidBaseUrl('ftp://example.com')).toBe(false)
    expect(isValidBaseUrl('file:///etc/passwd')).toBe(false)
    expect(isValidBaseUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isValidBaseUrl('')).toBe(false)
    expect(isValidBaseUrl('not-a-url')).toBe(false)
    expect(isValidBaseUrl('://missing-protocol')).toBe(false)
  })
})
