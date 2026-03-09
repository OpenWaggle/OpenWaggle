import { describe, expect, it } from 'vitest'
import { classifyKilledCommandOutcome, redactSensitiveText, toLogPreview } from '../run-command'

describe('redactSensitiveText', () => {
  it('redacts bearer tokens, api keys, github tokens and private keys', () => {
    const input = [
      'Authorization: Bearer abc.def.ghi',
      'OPENAI_KEY=sk-1234567890abcdefghijklmnop',
      'token=ghp_1234567890abcdefghijklmnopqrstuv',
      '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
    ].join('\n')

    const redacted = redactSensitiveText(input)
    expect(redacted).not.toContain('abc.def.ghi')
    expect(redacted).not.toContain('sk-1234567890abcdefghijklmnop')
    expect(redacted).not.toContain('ghp_1234567890abcdefghijklmnopqrstuv')
    expect(redacted).not.toContain('BEGIN PRIVATE KEY')
    expect(redacted).toContain('[REDACTED_TOKEN]')
    expect(redacted).toContain('[REDACTED_API_KEY]')
    expect(redacted).toContain('[REDACTED_GITHUB_TOKEN]')
    expect(redacted).toContain('[REDACTED_PRIVATE_KEY]')
  })
})

describe('toLogPreview', () => {
  it('truncates preview output at 1KB', () => {
    const long = 'x'.repeat(1200)
    const preview = toLogPreview(long)
    expect(preview.truncated).toBe(true)
    expect(preview.preview.length).toBeGreaterThan(1024)
    expect(preview.preview).toContain('[truncated in log]')
  })

  it('redacts before returning preview', () => {
    const preview = toLogPreview('Bearer supersecret-token-value')
    expect(preview.truncated).toBe(false)
    expect(preview.preview).toContain('[REDACTED_TOKEN]')
    expect(preview.preview).not.toContain('supersecret-token-value')
  })
})

describe('classifyKilledCommandOutcome', () => {
  it('classifies explicit aborts as cancellations', () => {
    const result = classifyKilledCommandOutcome({
      aborted: true,
      command: 'pnpm test',
      timeout: 30000,
    })
    expect(result.logMessage).toBe('command cancelled')
    expect(result.userMessage).toContain('was cancelled')
  })

  it('classifies non-abort kills as timeouts', () => {
    const result = classifyKilledCommandOutcome({
      aborted: false,
      command: 'pnpm test',
      timeout: 30000,
    })
    expect(result.logMessage).toBe('command timed out')
    expect(result.userMessage).toContain('timed out after 30000ms')
  })
})
