import { describe, expect, it } from 'vitest'
import {
  assertForwardAppVersionTransition,
  expectedVersionOnlyManifest,
  latestReleaseCandidateTag,
  promotionGuardViolations,
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

  it('selects the newest release candidate for a Stable target only', () => {
    const tags = ['v1.0.0-rc.2', 'v1.0.0-rc.10', 'v1.0.0-beta.4', 'v1.1.0-rc.1', 'v1.0.0-rc.1']

    expect(latestReleaseCandidateTag(tags, '1.0.0')).toBe('v1.0.0-rc.10')
    expect(latestReleaseCandidateTag(tags, '1.2.0')).toBeNull()
    expect(latestReleaseCandidateTag(tags, '1.0.0-rc.11')).toBeNull()
  })

  it('allows only a version change and non-app paths between the last RC and Stable', () => {
    const releaseCandidateManifestJson = '{"name":"openwaggle","version":"1.0.0-rc.3","private":true}'

    expect(
      promotionGuardViolations({
        changedPaths: ['package.json', 'website/src/content/docs/index.md', 'docs/adr/0039.md', 'README.md', '.agents/skills/release/SKILL.md'],
        releaseCandidateManifestJson,
        candidateManifestJson: '{"name":"openwaggle","version":"1.0.0","private":true}',
      }),
    ).toEqual([])
  })

  it('reports app changes and manifest changes beyond the version', () => {
    expect(
      promotionGuardViolations({
        changedPaths: ['package.json', 'pnpm-lock.yaml', 'src/main/updater.ts', 'docs/notes.md'],
        releaseCandidateManifestJson: '{"name":"openwaggle","version":"1.0.0-rc.3"}',
        candidateManifestJson: '{"name":"openwaggle","version":"1.0.0","dependencies":{"lodash":"4.17.21"}}',
      }),
    ).toEqual(['package.json', 'pnpm-lock.yaml', 'src/main/updater.ts'])
  })
})
