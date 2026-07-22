import { describe, expect, it } from 'vitest'
import {
  expectedVersionOnlyManifest,
  mergeRecoveryAction,
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

  it.each([
    [{ state: 'MERGED', mergeStateStatus: 'UNKNOWN' }, 'complete'],
    [{ state: 'OPEN', mergeStateStatus: 'BEHIND' }, 'retry'],
    [{ state: 'OPEN', mergeStateStatus: 'UNKNOWN' }, 'poll'],
    [{ state: 'OPEN', mergeStateStatus: 'BLOCKED' }, 'poll'],
    [{ state: 'OPEN', mergeStateStatus: 'UNSTABLE' }, 'poll'],
    [{ state: 'OPEN', mergeStateStatus: 'CLEAN' }, 'poll'],
    [{ state: 'CLOSED', mergeStateStatus: 'UNKNOWN' }, 'conflict'],
    [{ state: 'OPEN', mergeStateStatus: 'DIRTY' }, 'conflict'],
  ])('maps merge recovery state %j to %s', (input, expected) => {
    expect(mergeRecoveryAction(input)).toBe(expected)
  })
})
