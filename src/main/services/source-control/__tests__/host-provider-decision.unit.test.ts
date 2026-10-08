import { describe, expect, it } from 'vitest'
import {
  decideSourceControlHostProvider,
  type SourceControlHostSignals,
} from '../host-provider-decision'

const NO_SIGNALS: SourceControlHostSignals = {
  userChoices: {},
  approvedDeclarations: {},
  cliHosts: { github: [], gitlab: [] },
  credentialHelpers: {},
  detectedHosts: {},
}

function signals(overrides: Partial<SourceControlHostSignals>): SourceControlHostSignals {
  return { ...NO_SIGNALS, ...overrides }
}

describe('deciding which provider a Source control host belongs to', () => {
  it('lets the user choice win over everything else', () => {
    expect(
      decideSourceControlHostProvider(
        'github.com',
        'acme',
        signals({ userChoices: { 'github.com': 'gitlab' } }),
      ),
    ).toEqual({ provider: 'gitlab', source: 'user-choice' })
  })

  it('uses an approved project declaration before detection', () => {
    expect(
      decideSourceControlHostProvider(
        'code.acme.io',
        'acme',
        signals({
          approvedDeclarations: { 'code.acme.io': 'gitlab' },
          credentialHelpers: { 'code.acme.io': 'github' },
        }),
      ),
    ).toEqual({ provider: 'gitlab', source: 'project-declaration' })
  })

  it('knows the public hosts', () => {
    expect(decideSourceControlHostProvider('gitlab.com', 'acme', NO_SIGNALS)).toEqual({
      provider: 'gitlab',
      source: 'public-host',
    })
  })

  it('uses the hosts gh or glab are configured for', () => {
    const cliHosts = {
      github: [{ host: 'code.acme.io', accounts: [] }],
      gitlab: [{ host: 'git.acme.io', sshHost: null, accounts: [] }],
    }
    expect(decideSourceControlHostProvider('code.acme.io', 'acme', signals({ cliHosts }))).toEqual({
      provider: 'github',
      source: 'cli-sign-in',
    })
    expect(decideSourceControlHostProvider('git.acme.io', 'acme', signals({ cliHosts }))).toEqual({
      provider: 'gitlab',
      source: 'cli-sign-in',
    })
  })

  it('skips a host both CLIs are configured for', () => {
    const cliHosts = {
      github: [{ host: 'git.acme.io', accounts: [] }],
      gitlab: [{ host: 'git.acme.io', sshHost: null, accounts: [] }],
    }
    expect(decideSourceControlHostProvider('git.acme.io', 'acme', signals({ cliHosts }))).toBeNull()
  })

  it('uses a per-host gh or glab git credential helper', () => {
    expect(
      decideSourceControlHostProvider(
        'git.acme.io',
        'acme',
        signals({ credentialHelpers: { 'git.acme.io': 'gitlab' } }),
      ),
    ).toEqual({ provider: 'gitlab', source: 'git-credential-helper' })
  })

  it('reads a path deeper than owner/repo as GitLab', () => {
    expect(decideSourceControlHostProvider('git.acme.io', 'acme/platform', NO_SIGNALS)).toEqual({
      provider: 'gitlab',
      source: 'repository-path',
    })
  })

  it('falls back to a hostname that names a provider', () => {
    expect(decideSourceControlHostProvider('github.acme.io', 'acme', NO_SIGNALS)).toEqual({
      provider: 'github',
      source: 'host-name',
    })
  })

  it('uses providers learned from the remote refs last', () => {
    expect(
      decideSourceControlHostProvider(
        'git.acme.io',
        'acme',
        signals({ detectedHosts: { 'git.acme.io': 'github' } }),
      ),
    ).toEqual({ provider: 'github', source: 'remote-refs' })
  })

  it('leaves an unrecognised host undecided', () => {
    expect(decideSourceControlHostProvider('git.acme.io', 'acme', NO_SIGNALS)).toBeNull()
  })
})
