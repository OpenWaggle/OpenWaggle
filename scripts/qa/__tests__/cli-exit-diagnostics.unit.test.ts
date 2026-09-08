import { describe, expect, it } from 'vitest'
import { cliExitError } from '../cli-exit-diagnostics'

describe('QA CLI exit diagnostics', () => {
  it('includes escaped stderr explaining a nonzero exit', () => {
    const stderr = '{"error":{"message":"The platform credential store is unavailable."}}\n'
    expect(cliExitError(3, null, stderr).message).toBe(
      `OpenWaggle CLI exited with 3. stderr: ${JSON.stringify(stderr)}`,
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
