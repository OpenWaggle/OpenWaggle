import { describe, expect, it } from 'vitest'
import { cliExitError, cliProcessError } from '../cli-exit-diagnostics'

describe('QA CLI exit diagnostics', () => {
  it('reports a structured Host rejection without exposing the rest of stdout', () => {
    const credential = 'a'.repeat(43)
    const stdout = JSON.stringify({
      outcome: { effect: 'rejected', code: 'management_envelope_exceeded' },
      credential,
      privateMessage: 'private conversation text',
    })
    const message = cliExitError(4, null, '', stdout).message
    expect(message).toBe(
      'OpenWaggle CLI exited with 4. outcome: rejected (management_envelope_exceeded).',
    )
    expect(message).not.toContain(credential)
    expect(message).not.toContain('private conversation text')
  })

  it('includes escaped stderr explaining a nonzero exit', () => {
    const stderr = '{"error":{"message":"The platform credential store is unavailable."}}\n'
    expect(cliExitError(3, null, stderr).message).toBe(
      `OpenWaggle CLI exited with 3. stderr: ${JSON.stringify(stderr)}`,
    )
  })

  it('converts execFile failures without retaining secret arguments or the original error', () => {
    const credential = 'a'.repeat(43)
    const error = Object.assign(new Error(`Command failed: executable --credential ${credential}`), {
      code: 4,
      signal: null,
      stdout: JSON.stringify({ outcome: { effect: 'rejected', code: 'management_envelope_exceeded' } }),
      stderr: '',
    })
    const diagnostic = cliProcessError(error)
    expect(diagnostic.message).toContain(
      'exited with 4. outcome: rejected (management_envelope_exceeded).',
    )
    expect(diagnostic.message).not.toContain(credential)
    expect(diagnostic.cause).toBeUndefined()
  })

  it.each([
    ['malformed JSON', 'private credential abc'],
    ['non-rejection output', JSON.stringify({ credential: 'private credential abc' })],
    [
      'unsafe rejection code',
      JSON.stringify({ outcome: { effect: 'rejected', code: 'private credential abc' } }),
    ],
    [
      'oversized output',
      JSON.stringify({
        outcome: { effect: 'rejected', code: 'management_envelope_exceeded' },
        secret: 'private credential abc'.repeat(1_000),
      }),
    ],
  ])('omits %s without echoing its content', (_label, stdout) => {
    const message = cliExitError(4, null, '', stdout).message
    expect(message).not.toContain('private credential abc')
    expect(message.length).toBeLessThan(150)
  })

  it('redacts credential-shaped rejection codes and rejects untrusted signal text', () => {
    const credential = 'a'.repeat(43)
    const message = cliExitError(
      null,
      credential,
      '',
      JSON.stringify({ outcome: { effect: 'rejected', code: credential } }),
    ).message
    expect(message).not.toContain(credential)
    expect(message).toContain('[REDACTED_CREDENTIAL]')
  })

  it('handles missing or malformed process output without printing arbitrary errors', () => {
    expect(cliProcessError('private command').message).toBe('OpenWaggle CLI exited with null.')
    expect(cliProcessError({ code: 1, stdout: { private: true }, stderr: 123 }).message).toBe(
      'OpenWaggle CLI exited with 1.',
    )
    expect(cliProcessError({ signal: 'SIGTERM', stdout: '', stderr: '' }).message).toBe(
      'OpenWaggle CLI exited with SIGTERM.',
    )
  })

  it('preserves signal and empty-output failures', () => {
    expect(cliExitError(null, 'SIGKILL', '').message).toBe('OpenWaggle CLI exited with SIGKILL.')
    expect(cliExitError(1, null, '').message).toBe('OpenWaggle CLI exited with 1.')
  })

  it('redacts credentials and provider tokens before limiting diagnostics', () => {
    const credential = 'a'.repeat(43)
    const providerKey = `sk-${'b'.repeat(32)}`
    const githubToken = `github_pat_${'c'.repeat(30)}`
    const message = cliExitError(3, null, `${credential} ${providerKey} ${githubToken}`).message
    expect(message).not.toContain(credential)
    expect(message).not.toContain(providerKey)
    expect(message).not.toContain(githubToken)
    expect(message).toContain('[REDACTED')
  })

  it('bounds escaped output while retaining the beginning of the CLI error', () => {
    const message = cliExitError(3, null, `failure\n${'x '.repeat(5_000)}`).message
    expect(message).toContain('failure\\n')
    expect(message.length).toBeLessThan(1_100)
    expect(message).toContain('…')
  })

  it('applies its limit after escaping control characters', () => {
    const message = cliExitError(3, null, '\u0000'.repeat(1_000)).message
    expect(message.length).toBeLessThan(1_100)
    expect(message).not.toContain('\u0000')
  })
})
