import { describe, expect, it } from 'vitest'
import {
  assertForwardAppVersionTransition,
  expectedVersionOnlyManifest,
  releaseSubjectVersion,
  selectOwnedReleasePullRequests,
  type AppReleasePullRequest,
} from '../app-release-state'

function pullRequest(
  overrides: Partial<AppReleasePullRequest> = {},
): AppReleasePullRequest {
  return {
    baseRefName: 'main',
    headRefName: 'app-release-v0.3.0-alpha.45',
    headRefOid: 'a'.repeat(40),
    headRepository: { name: 'OpenWaggle' },
    headRepositoryOwner: { login: 'OpenWaggle' },
    isCrossRepository: false,
    mergeCommit: null,
    number: 123,
    state: 'OPEN',
    title: 'chore(release): v0.3.0-alpha.45',
    url: 'https://github.com/OpenWaggle/OpenWaggle/pull/123',
    ...overrides,
  }
}

describe('app release state model', () => {
  it('accepts protected promotion and next-line prerelease transitions', () => {
    expect(() => assertForwardAppVersionTransition('0.4.0-alpha.3', '0.4.0')).not.toThrow()
    expect(() => assertForwardAppVersionTransition('0.4.0', '0.5.0-alpha.1')).not.toThrow()
    expect(() => assertForwardAppVersionTransition('0.5.0-beta.2', '0.5.0-rc.1')).not.toThrow()
  })

  it('rejects equal versions, older cores, and less-stable same-line channels', () => {
    expect(() => assertForwardAppVersionTransition('0.4.0', '0.4.0')).toThrow(/does not advance/u)
    expect(() => assertForwardAppVersionTransition('0.5.0-alpha.1', '0.4.1')).toThrow(/older/u)
    expect(() => assertForwardAppVersionTransition('0.5.0-beta.1', '0.5.0-alpha.9')).toThrow(
      /does not advance/u,
    )
  })

  it('selects only the same-repository release PR', () => {
    const selected = selectOwnedReleasePullRequests(
      [
        pullRequest(),
        pullRequest({ isCrossRepository: true, number: 124 }),
        pullRequest({ headRepositoryOwner: { login: 'attacker' }, number: 125 }),
        pullRequest({ headRepository: { name: 'fork' }, number: 126 }),
        pullRequest({ headRefName: 'another-branch', number: 127 }),
      ],
      {
        branch: 'app-release-v0.3.0-alpha.45',
        owner: 'OpenWaggle',
        repository: 'OpenWaggle',
      },
    )

    expect(selected.map(({ number }) => number)).toEqual([123])
  })

  it('creates an exact manifest with only the version changed', () => {
    const base = '{\n  "name": "openwaggle",\n  "version": "0.3.0-alpha.44",\n  "private": true\n}\n'

    expect(expectedVersionOnlyManifest(base, '0.3.0-alpha.45')).toBe(
      '{\n  "name": "openwaggle",\n  "version": "0.3.0-alpha.45",\n  "private": true\n}\n',
    )
  })

  it('accepts exact and GitHub squash release subjects only', () => {
    expect(releaseSubjectVersion('chore(release): v0.3.0-alpha.45')).toBe(
      '0.3.0-alpha.45',
    )
    expect(releaseSubjectVersion('chore(release): v0.3.0-alpha.45 (#123)')).toBe(
      '0.3.0-alpha.45',
    )
    expect(releaseSubjectVersion('chore(release): v0.3.0-alpha.45 extra')).toBeNull()
    expect(releaseSubjectVersion('fix(release): v0.3.0-alpha.45 (#123)')).toBeNull()
  })
})
