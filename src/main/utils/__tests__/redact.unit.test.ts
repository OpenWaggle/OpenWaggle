import { describe, expect, it } from 'vitest'
import { redactSensitiveText } from '../redact'

describe('redactSensitiveText', () => {
  it('redacts private keys', () => {
    const input = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----'
    expect(redactSensitiveText(input)).toBe('[REDACTED_PRIVATE_KEY]')
  })

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9'
    expect(redactSensitiveText(input)).toContain('Bearer [REDACTED_TOKEN]')
  })

  it('redacts sk- API keys', () => {
    const input = 'key=sk-1234567890abcdefghij'
    expect(redactSensitiveText(input)).toContain('[REDACTED_API_KEY]')
  })

  it('redacts GitHub PATs', () => {
    const input = 'token=github_pat_11ABCDEFGHIJKLMNOPQRST_abcdefghijklmnopqrstuvwxyz1234567890'
    expect(redactSensitiveText(input)).toContain('[REDACTED_GITHUB_TOKEN]')
  })

  it('redacts ghp_ tokens', () => {
    const input = 'ghp_ABCDEFGHIJKLMNOPQRSTtoken'
    expect(redactSensitiveText(input)).toContain('[REDACTED_GITHUB_TOKEN]')
  })

  it('leaves non-sensitive text unchanged', () => {
    const input = 'This is a normal log line with no secrets'
    expect(redactSensitiveText(input)).toBe(input)
  })

  it('handles empty string', () => {
    expect(redactSensitiveText('')).toBe('')
  })
})
