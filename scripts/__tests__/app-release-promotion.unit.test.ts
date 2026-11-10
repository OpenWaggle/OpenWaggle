import { describe, expect, it } from 'vitest'
import electronBuilderConfig from '../../electron-builder'
import {
  isPromotionIgnoredPath,
  latestReleaseCandidateTag,
  promotionBase,
  promotionGuardViolations,
  publishedReleaseTags,
  requiresReleaseCandidate,
} from '../app-release-promotion'

describe('app release promotion guard', () => {
  it('selects the newest release candidate for a Stable target only', () => {
    const tags = ['v1.0.0-rc.2', 'v1.0.0-rc.10', 'v1.0.0-beta.4', 'v1.1.0-rc.1', 'v1.0.0-rc.1']

    expect(latestReleaseCandidateTag(tags, '1.0.0')).toBe('v1.0.0-rc.10')
    expect(latestReleaseCandidateTag(tags, '1.2.0')).toBeNull()
    expect(latestReleaseCandidateTag(tags, '1.0.0-rc.11')).toBeNull()
  })

  it('allows only a version change and non-app paths between the last RC and Stable', () => {
    const releaseCandidateManifestJson =
      '{"name":"openwaggle","version":"1.0.0-rc.3","private":true}'

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
        candidateManifestJson:
          '{"name":"openwaggle","version":"1.0.0","dependencies":{"lodash":"4.17.21"}}',
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
    // Every extraResources source, plus every app.asar `files` pattern that adds files. The guard
    // matches path prefixes, so a positive pattern must start with a literal directory or file.
    const includedPatterns = electronBuilderConfig.files.filter(
      (pattern) => !pattern.startsWith('!'),
    )
    const shippedPaths = [
      ...electronBuilderConfig.extraResources.map((resource) => resource.from),
      ...includedPatterns,
    ]

    expect(includedPatterns.filter((pattern) => /^[*?{[]/u.test(pattern))).toEqual([])

    expect(shippedPaths).toContain('THIRD_PARTY_NOTICES.md')
    expect(shippedPaths).toContain('package.json')
    expect(shippedPaths.filter((shippedPath) => isPromotionIgnoredPath(shippedPath))).toEqual([])
  })

  describe('promotion base', () => {
    const releases = (...tags: readonly (readonly [string, boolean])[]) =>
      [['waggle-core-v0.2.0', false] as const, ...tags]
        .map(([tag, draft]) => JSON.stringify({ tag_name: tag, draft }))
        .join('\n')

    it('skips prereleases without reading the release list', () => {
      expect(
        promotionBase({
          targetVersion: '1.0.0-rc.2',
          gitHubReleaseLines: undefined,
          localTags: [],
        }),
      ).toEqual({
        kind: 'skip',
        reason: '1.0.0-rc.2 is a prerelease; the promotion guard applies to Stable only.',
      })
    })

    it('rejects a malformed target', () => {
      expect(() =>
        promotionBase({ targetVersion: '1.0', gitHubReleaseLines: releases(), localTags: [] }),
      ).toThrow('Invalid desktop app version: 1.0.')
    })

    it('requires the release list for a Stable target', () => {
      expect(() =>
        promotionBase({ targetVersion: '1.0.0', gitHubReleaseLines: undefined, localTags: [] }),
      ).toThrow(/needs --releases/u)
    })

    it('compares with the newest published RC and reports newer unpublished or draft tags', () => {
      expect(
        promotionBase({
          targetVersion: '1.0.0',
          gitHubReleaseLines: releases(['v1.0.0-rc.1', false], ['v1.0.0-rc.2', true]),
          localTags: ['v1.0.0-rc.1', 'v1.0.0-rc.2', 'v1.0.0-rc.3', 'v1.0.0-rc.3.bak'],
        }),
      ).toEqual({
        kind: 'compare',
        tag: 'v1.0.0-rc.1',
        ignoredTags: ['v1.0.0-rc.2', 'v1.0.0-rc.3'],
      })
    })

    it('requires a published RC before a new major', () => {
      expect(() =>
        promotionBase({
          targetVersion: '1.0.0',
          gitHubReleaseLines: releases(),
          localTags: ['v1.0.0-rc.1'],
        }),
      ).toThrow('Stable 1.0.0 needs a published 1.0.0-rc.N release first.')
    })

    it('lets a minor without RC tags skip the guard but fails one whose RCs never published', () => {
      expect(
        promotionBase({
          targetVersion: '1.1.0',
          gitHubReleaseLines: releases(),
          localTags: ['v1.1.0-rc.1.bak'],
        }),
      ).toEqual({
        kind: 'skip',
        reason: 'No published release candidate precedes 1.1.0; promotion guard skipped.',
      })
      expect(() =>
        promotionBase({
          targetVersion: '1.1.0',
          gitHubReleaseLines: releases(),
          localTags: ['v1.1.0-rc.1'],
        }),
      ).toThrow(
        /has release candidate tags but no published release candidate[\s\S]*v1\.1\.0-rc\.1/u,
      )
    })

    it('fails when the published RC has no tag in the checkout', () => {
      expect(() =>
        promotionBase({
          targetVersion: '1.0.0',
          gitHubReleaseLines: releases(['v1.0.0-rc.1', false]),
          localTags: [],
        }),
      ).toThrow('Published release candidate v1.0.0-rc.1 has no tag in this checkout.')
    })
  })
})
