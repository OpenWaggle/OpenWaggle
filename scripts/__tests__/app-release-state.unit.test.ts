import { describe, expect, it } from 'vitest'
import {
  releaseTagAction,
  releaseSubjectVersion,
  releaseValidationAction,
  selectOwnedReleasePullRequests,
  type AppReleasePullRequest,
} from '../app-release-state'

function pullRequest(
  overrides: Partial<AppReleasePullRequest> = {},
): AppReleasePullRequest {
  return {
    baseRefName: 'main',
    headRefName: 'app-release',
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
        branch: 'app-release',
        owner: 'OpenWaggle',
        repository: 'OpenWaggle',
      },
    )

    expect(selected.map(({ number }) => number)).toEqual([123])
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

  it('fails after three release-title mismatches', () => {
    const actions = [1, 2, 3].map((attempt) =>
      releaseValidationAction('wrong title', 'chore(release): v0.3.0-alpha.45', attempt, 3),
    )

    expect(actions).toEqual(['retry', 'retry', 'fail'])
    expect(
      releaseValidationAction(
        'chore(release): v0.3.0-alpha.45',
        'chore(release): v0.3.0-alpha.45',
        3,
        3,
      ),
    ).toBe('validate')
  })

  it('fails closed for a conflicting release tag', () => {
    const mergeSha = 'a'.repeat(40)
    const conflictingSha = 'b'.repeat(40)

    expect(releaseTagAction(null, null)).toBe('create')
    expect(releaseTagAction(null, mergeSha)).toBe('create')
    expect(releaseTagAction(mergeSha, mergeSha)).toBe('reuse')
    expect(releaseTagAction(conflictingSha, mergeSha)).toBe('conflict')
    expect(releaseTagAction(conflictingSha, null)).toBe('conflict')
  })
})
