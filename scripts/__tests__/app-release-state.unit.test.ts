import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertForwardAppVersionTransition,
  expectedVersionOnlyManifest,
  isPromotionIgnoredPath,
  latestReleaseCandidateTag,
  promotionGuardViolations,
  publishedReleaseTags,
  requiresReleaseCandidate,
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
        changedPaths: [
          'package.json',
          'website/src/pages/index.astro',
          'docs/adr/0040.md',
          'README.md',
          '.agents/skills/release/SKILL.md',
        ],
        releaseCandidateManifestJson,
        candidateManifestJson: '{"name":"openwaggle","version":"1.0.0","private":true}',
      }),
    ).toEqual([])
  })

  it('reports app changes and manifest changes beyond the version', () => {
    expect(
      promotionGuardViolations({
        changedPaths: [
          'package.json',
          'pnpm-lock.yaml',
          'src/main/updater.ts',
          'docs/notes.md',
          'website/src/content/docs/getting-started/installation.md',
        ],
        releaseCandidateManifestJson: '{"name":"openwaggle","version":"1.0.0-rc.3"}',
        candidateManifestJson: '{"name":"openwaggle","version":"1.0.0","dependencies":{"lodash":"4.17.21"}}',
      }),
    ).toEqual([
      'package.json',
      'pnpm-lock.yaml',
      'src/main/updater.ts',
      'website/src/content/docs/getting-started/installation.md',
    ])
  })

  it('requires a release candidate only before a new major version', () => {
    expect(requiresReleaseCandidate('1.0.0')).toBe(true)
    expect(requiresReleaseCandidate('2.0.0')).toBe(true)
    expect(requiresReleaseCandidate('1.1.0')).toBe(false)
    expect(requiresReleaseCandidate('1.0.1')).toBe(false)
  })

  it('reads only published release tags from the GitHub release list', () => {
    const lines = [
      '{"draft":false,"tag_name":"v1.0.0-rc.1"}',
      '{"draft":true,"tag_name":"v1.0.0-rc.2"}',
      '',
      '{"draft":false,"tag_name":"waggle-core-v0.2.0"}',
    ].join('\n')

    expect(publishedReleaseTags(lines)).toEqual(['v1.0.0-rc.1', 'waggle-core-v0.2.0'])
    // An RC tag without a published release (its builds failed) never becomes the guard's base.
    expect(latestReleaseCandidateTag(publishedReleaseTags(lines), '1.0.0')).toBe('v1.0.0-rc.1')
  })

  it('fails closed on an empty or malformed GitHub release list', () => {
    expect(() => publishedReleaseTags('')).toThrow(/release list is empty/u)
    expect(() => publishedReleaseTags('\n\n')).toThrow(/release list is empty/u)
    expect(() => publishedReleaseTags('{"tag_name":"v1.0.0-rc.1"}')).toThrow()
    expect(() => publishedReleaseTags('not json')).toThrow()
  })

  it('treats THIRD_PARTY_NOTICES.md as app content although it is a top-level Markdown file', () => {
    expect(isPromotionIgnoredPath('README.md')).toBe(true)
    expect(isPromotionIgnoredPath('THIRD_PARTY_NOTICES.md')).toBe(false)
    expect(
      promotionGuardViolations({
        changedPaths: ['THIRD_PARTY_NOTICES.md', 'CHANGELOG.md'],
        releaseCandidateManifestJson: '{"version":"1.0.0-rc.1"}',
        candidateManifestJson: '{"version":"1.0.0"}',
      }),
    ).toEqual(['THIRD_PARTY_NOTICES.md'])
  })

  it('never ignores a file that electron-builder copies into the app', () => {
    const config = fs.readFileSync(path.join(process.cwd(), 'electron-builder.ts'), 'utf8')
    const shippedPaths = [...config.matchAll(/\{ from: '([^']+)', to: /gu)].map((match) => match[1] ?? '')

    expect(shippedPaths).toContain('THIRD_PARTY_NOTICES.md')
    expect(shippedPaths.filter((shippedPath) => isPromotionIgnoredPath(shippedPath))).toEqual([])
  })
})
