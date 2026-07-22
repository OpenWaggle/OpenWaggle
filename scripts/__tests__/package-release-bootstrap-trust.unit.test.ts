import { describe, expect, it } from 'vitest'
import { parseTrustListOutput } from '../package-release-bootstrap-trust'
import { compatibleTrustConfiguration } from './package-release-bootstrap-test-helpers'

describe('package release bootstrap trust output', () => {
  it('ignores the npm authentication handoff and returns the trust configuration', () => {
    const trust = compatibleTrustConfiguration()
    const output = [
      JSON.stringify({
        title: 'Authenticate your account at',
        url: 'https://www.npmjs.com/auth/cli/redacted',
      }),
      JSON.stringify(trust, null, 2),
    ].join('\r\n')

    expect(parseTrustListOutput(output)).toEqual(trust)
  })

  it('returns an empty list when the authenticated package has no trust configuration', () => {
    const output = JSON.stringify({
      title: 'Authenticate your account at',
      url: 'https://www.npmjs.com/auth/cli/redacted',
    })

    expect(parseTrustListOutput(output)).toEqual([])
  })

  it('preserves multiple configurations so compatibility validation fails closed', () => {
    const first = compatibleTrustConfiguration()
    const second = { ...first, repository: 'untrusted/repository' }

    expect(parseTrustListOutput(`${JSON.stringify(first)}\n${JSON.stringify(second)}`)).toEqual([
      first,
      second,
    ])
  })
})
