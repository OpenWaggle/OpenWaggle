import { describe, it } from 'vitest'
import { type ReleaseTrainHistoryEntry, runReleaseTrain } from './app-release-train.test-harness'

// The RC and Stable paths of release.yml's version job, run against a local Git remote with a
// mocked GitHub API (app-release-train.test-harness.ts). The build, installer, and publication jobs
// need real runners and secrets, so they are not exercised here.

const CHANGELOG = '# Changelog\n\n## 1.0.0\n\nThe first Stable release.\n'
const BETA: ReleaseTrainHistoryEntry = {
  kind: 'release',
  version: '1.0.0-beta.37',
  release: 'published',
}
const RC_1: ReleaseTrainHistoryEntry = {
  kind: 'release',
  version: '1.0.0-rc.1',
  release: 'published',
}
const RELEASE_BLOCKER_FIX: ReleaseTrainHistoryEntry = {
  kind: 'change',
  subject: 'fix: release blocker',
  path: 'src/app.ts',
}
const DOCS_CHANGE: ReleaseTrainHistoryEntry = {
  kind: 'change',
  subject: 'docs: release notes',
  path: 'docs/notes.md',
}
// The 1.0.0 entry is written during the RC window, so it is a change since rc.1.
const CHANGELOG_ENTRY: ReleaseTrainHistoryEntry = {
  kind: 'change',
  subject: 'docs: 1.0.0 changelog',
  path: 'CHANGELOG.md',
  content: CHANGELOG,
}

// Each case has its own temporary repositories, so they run concurrently.
// Under a loaded runner one case has taken 43 s, close to the tier's 60 s deadline.
const TRAIN_CASE_TIMEOUT_MS = 180_000

describe.concurrent(
  'desktop app release candidate and Stable paths',
  { timeout: TRAIN_CASE_TIMEOUT_MS },
  () => {
    it('prepares the 1.0.0-rc.1 release PR from a target_version dispatch', async ({ expect }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0-beta.36',
        history: [BETA],
        run: { kind: 'dispatch', targetVersion: '1.0.0-rc.1' },
      })

      expect(result.succeeded, result.stderr).toBe(true)
      expect(result.events).toEqual(['create', `ci ${result.releaseBranchHead}`])
      expect(result.releaseBranchManifest).toContain('"version": "1.0.0-rc.1"')
      expect(Object.keys(result.tags)).toEqual(['v1.0.0-beta.37'])
      expect(result.outputs).toBe('should_release=false\n')
      expect(result.stdout).toContain('Release PR ready for maintainer review')
    })

    it.for([
      ['signing', { macosSigning: false }],
      ['notarization', { macosNotarization: false }],
    ] as const)(
      'refuses an RC dispatch without macOS %s before any branch, PR, or tag exists',
      async ([, secrets], { expect }) => {
        const result = await runReleaseTrain({
          initialVersion: '1.0.0-beta.36',
          history: [BETA],
          run: { kind: 'dispatch', targetVersion: '1.0.0-rc.1' },
          ...secrets,
        })

        expect(result.succeeded).toBe(false)
        expect(result.stderr).toContain('1.0.0-rc.1 needs signed and notarized macOS builds')
        expect(result.events).toEqual([])
        expect(result.releaseBranchHead).toBeNull()
        expect(Object.keys(result.tags)).toEqual(['v1.0.0-beta.37'])
      },
    )

    it('prepares rc.2 when a release-blocker fix merges after rc.1', async ({ expect }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0-beta.37',
        history: [RC_1, RELEASE_BLOCKER_FIX],
        run: { kind: 'merge' },
      })

      expect(result.succeeded, result.stderr).toBe(true)
      expect(result.bumpVersion).toBe('1.0.0-rc.2')
      expect(result.events).toEqual(['create', `ci ${result.releaseBranchHead}`])
      expect(result.releaseBranchManifest).toContain('"version": "1.0.0-rc.2"')
    })

    it('tags the maintainer-merged rc.2 release commit', async ({ expect }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0-beta.37',
        history: [RC_1, RELEASE_BLOCKER_FIX],
        run: { kind: 'release-merge', version: '1.0.0-rc.2' },
      })

      expect(result.succeeded, result.stderr).toBe(true)
      expect(result.tags['v1.0.0-rc.2']).toBe(result.mainSha)
      expect(result.outputs).toBe(
        'new_version=1.0.0-rc.2\nnew_tag=v1.0.0-rc.2\nshould_release=true\n',
      )
      // A prerelease never reads the release list: the promotion guard is for Stable only.
      expect(result.events).toEqual([])
    })

    it('does not tag a merged rc.2 release commit without macOS signing', async ({ expect }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0-beta.37',
        history: [RC_1, RELEASE_BLOCKER_FIX],
        run: { kind: 'release-merge', version: '1.0.0-rc.2' },
        macosSigning: false,
      })

      expect(result.succeeded).toBe(false)
      expect(result.stderr).toContain('1.0.0-rc.2 needs signed and notarized macOS builds')
      expect(result.tags['v1.0.0-rc.2']).toBeUndefined()
    })

    it('fails a Stable 1.0.0 dispatch without a CHANGELOG entry', async ({ expect }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0-beta.37',
        history: [RC_1],
        run: { kind: 'dispatch', targetVersion: '1.0.0' },
      })

      expect(result.succeeded).toBe(false)
      expect(result.stderr).toContain(
        'Stable 1.0.0 needs a hand-written "## 1.0.0" entry in CHANGELOG.md',
      )
      expect(result.events).toEqual([])
      expect(result.releaseBranchHead).toBeNull()
    })

    it('prepares Stable 1.0.0 when main matches rc.1 apart from non-app paths', async ({
      expect,
    }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0-beta.37',
        history: [RC_1, DOCS_CHANGE, CHANGELOG_ENTRY],
        run: { kind: 'dispatch', targetVersion: '1.0.0' },
      })

      expect(result.succeeded, result.stderr).toBe(true)
      expect(result.stdout).toContain(
        'Stable 1.0.0 matches v1.0.0-rc.1, the last published release candidate.',
      )
      expect(result.events).toEqual(['releases', 'create', `ci ${result.releaseBranchHead}`])
      expect(result.releaseBranchManifest).toContain('"version": "1.0.0"')
    })

    it('checks the promotion guard again before tagging a merged Stable release commit', async ({
      expect,
    }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0-beta.37',
        history: [RC_1, DOCS_CHANGE, CHANGELOG_ENTRY],
        run: { kind: 'release-merge', version: '1.0.0' },
      })

      expect(result.succeeded, result.stderr).toBe(true)
      expect(result.events).toEqual(['releases', 'releases'])
      expect(result.tags['v1.0.0']).toBe(result.mainSha)
    })

    it.for(['src/app.ts', 'THIRD_PARTY_NOTICES.md'])(
      'fails Stable 1.0.0 when %s changed since the last RC',
      async (changedPath, { expect }) => {
        const result = await runReleaseTrain({
          initialVersion: '1.0.0-beta.37',
          history: [RC_1, { kind: 'change', subject: 'chore: drift', path: changedPath }],
          changelog: CHANGELOG,
          run: { kind: 'dispatch', targetVersion: '1.0.0' },
        })

        expect(result.succeeded).toBe(false)
        expect(result.stderr).toContain('Stable 1.0.0 must match v1.0.0-rc.1')
        expect(result.stderr).toContain(changedPath)
        expect(result.events).toEqual(['releases'])
        expect(result.releaseBranchHead).toBeNull()
      },
    )

    it.for(['none', 'draft'] as const)(
      'compares Stable with the last published RC when a newer rc tag has release %s',
      async (release, { expect }) => {
        const result = await runReleaseTrain({
          initialVersion: '1.0.0-beta.37',
          history: [RC_1, RELEASE_BLOCKER_FIX, { kind: 'release', version: '1.0.0-rc.2', release }],
          changelog: CHANGELOG,
          run: { kind: 'dispatch', targetVersion: '1.0.0' },
        })

        expect(result.succeeded).toBe(false)
        expect(result.stdout).toContain(
          'Ignoring release candidate tags without a published release: v1.0.0-rc.2.',
        )
        expect(result.stderr).toContain('Stable 1.0.0 must match v1.0.0-rc.1')
        expect(result.stderr).toContain('src/app.ts')
        expect(result.releaseBranchHead).toBeNull()
      },
    )

    it('fails Stable 1.0.0 when only an unpublished RC exists', async ({ expect }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0-beta.37',
        history: [{ kind: 'release', version: '1.0.0-rc.1', release: 'none' }],
        changelog: CHANGELOG,
        run: { kind: 'dispatch', targetVersion: '1.0.0' },
      })

      expect(result.succeeded).toBe(false)
      expect(result.stderr).toContain('Stable 1.0.0 needs a published 1.0.0-rc.N release first.')
    })

    it('fails closed when the GitHub release list cannot be read', async ({ expect }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0-beta.37',
        history: [RC_1],
        changelog: CHANGELOG,
        run: { kind: 'dispatch', targetVersion: '1.0.0' },
        releasesUnreadable: true,
      })

      expect(result.succeeded).toBe(false)
      expect(result.stderr).toContain('HTTP 502')
      expect(result.events).toEqual(['releases'])
      expect(result.releaseBranchHead).toBeNull()
    })

    it('refuses a Stable dispatch without macOS signing before any branch, PR, or tag exists', async ({
      expect,
    }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0-beta.37',
        history: [RC_1, CHANGELOG_ENTRY],
        run: { kind: 'dispatch', targetVersion: '1.0.0' },
        macosSigning: false,
      })

      expect(result.succeeded).toBe(false)
      expect(result.stderr).toContain('1.0.0 needs signed and notarized macOS builds')
      expect(result.events).toEqual(['releases'])
      expect(result.releaseBranchHead).toBeNull()
      expect(result.tags['v1.0.0']).toBeUndefined()
    })

    it('fails when the published release candidate has no tag in the checkout', async ({
      expect,
    }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0-beta.37',
        history: [RC_1, CHANGELOG_ENTRY],
        run: { kind: 'dispatch', targetVersion: '1.0.0' },
        publishedWithoutTag: ['v1.0.0-rc.2'],
      })

      expect(result.succeeded).toBe(false)
      expect(result.stderr).toContain(
        'Published release candidate v1.0.0-rc.2 has no tag in this checkout.',
      )
      expect(result.releaseBranchHead).toBeNull()
    })

    it('fails a Stable minor whose release candidates never published', async ({ expect }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0',
        history: [
          { kind: 'release', version: '1.1.0-rc.1', release: 'none' },
          {
            kind: 'change',
            subject: 'docs: 1.1.0 changelog',
            path: 'CHANGELOG.md',
            content: '# Changelog\n\n## 1.1.0\n\nA minor.\n',
          },
        ],
        run: { kind: 'dispatch', targetVersion: '1.1.0' },
      })

      expect(result.succeeded).toBe(false)
      expect(result.stderr).toContain(
        'Stable 1.1.0 has release candidate tags but no published release candidate.',
      )
      expect(result.stderr).toContain('v1.1.0-rc.1')
      expect(result.releaseBranchHead).toBeNull()
    })

    it('lets a Stable minor without release candidates skip the promotion guard', async ({
      expect,
    }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0',
        history: [
          { kind: 'change', subject: 'feat: a minor feature', path: 'src/app.ts' },
          {
            kind: 'change',
            subject: 'docs: 1.1.0 changelog',
            path: 'CHANGELOG.md',
            content: '# Changelog\n\n## 1.1.0\n\nA minor.\n',
          },
        ],
        run: { kind: 'dispatch', targetVersion: '1.1.0' },
      })

      expect(result.succeeded, result.stderr).toBe(true)
      expect(result.stdout).toContain(
        'No published release candidate precedes 1.1.0; promotion guard skipped.',
      )
      expect(result.releaseBranchManifest).toContain('"version": "1.1.0"')
    })

    it('bumps a Beta merge to the next Beta', async ({ expect }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0-beta.36',
        history: [BETA, RELEASE_BLOCKER_FIX],
        run: { kind: 'merge' },
        macosSigning: false,
      })

      expect(result.succeeded, result.stderr).toBe(true)
      expect(result.bumpVersion).toBe('1.0.0-beta.38')
      expect(result.releaseBranchManifest).toContain('"version": "1.0.0-beta.38"')
    })

    it('bumps a fix after 1.0.0 to 1.0.1 and waits for its CHANGELOG entry', async ({ expect }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0-rc.1',
        history: [{ kind: 'release', version: '1.0.0', release: 'published' }, RELEASE_BLOCKER_FIX],
        run: { kind: 'merge' },
      })

      expect(result.succeeded, result.stderr).toBe(true)
      expect(result.bumpVersion).toBe('1.0.1')
      expect(result.stdout).toContain(
        'Stable 1.0.1 waits for its CHANGELOG.md entry; no release PR was prepared.',
      )
      expect(result.outputs).toBe('should_release=false\n')
      expect(result.events).toEqual([])
      expect(result.releaseBranchHead).toBeNull()
    })

    it('fails the bump step on an unrecognized version', async ({ expect }) => {
      const result = await runReleaseTrain({
        initialVersion: '1.0.0-preview.1',
        history: [RELEASE_BLOCKER_FIX],
        run: { kind: 'merge' },
      })

      expect(result.succeeded).toBe(false)
      expect(result.stderr).toContain('Unrecognized desktop app version 1.0.0-preview.1.')
      expect(result.releaseBranchHead).toBeNull()
    })
  },
)
