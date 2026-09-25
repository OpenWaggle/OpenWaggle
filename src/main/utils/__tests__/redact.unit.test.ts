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

  // Review finding: only Bearer, sk-, and GitHub tokens were redacted before errors were published.
  it('redacts labelled credentials, Basic auth, and common provider key formats', () => {
    const input = [
      'x-api-key: AIzaSyA1234567890abcdefghijklmnopqrstu',
      'api_key=0123456789abcdef',
      'Authorization: Basic dXNlcjpwYXNzd29yZA==',
      '{"password": "hunter22hunter"}',
      'AKIAABCDEFGHIJKLMNOP',
    ].join('\n')
    const output = redactSensitiveText(input)
    for (const secret of [
      'AIzaSyA1234567890',
      '0123456789abcdef',
      'dXNlcjpwYXNzd29yZA',
      'hunter22hunter',
      'AKIAABCDEFGHIJKLMNOP',
    ]) {
      expect(output).not.toContain(secret)
    }
  })

  it('does not redact ordinary words that resemble credential labels', () => {
    const input = 'token_count=483 and tokens used: 1024'
    expect(redactSensitiveText(input)).toBe(input)
  })

  it('leaves non-sensitive text unchanged', () => {
    const input = 'This is a normal log line with no secrets'
    expect(redactSensitiveText(input)).toBe(input)
  })

  it('handles empty string', () => {
    expect(redactSensitiveText('')).toBe('')
  })
})
