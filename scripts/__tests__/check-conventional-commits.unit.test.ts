import { describe, expect, it } from 'vitest'
import { validateConventionalCommitSubjects } from '../check-conventional-commits'

describe('Conventional Commit policy', () => {
  it('accepts allowed scoped and breaking commit subjects', () => {
    const violations = validateConventionalCommitSubjects([
      {
        body: 'BREAKING CHANGE: extension manifests now require an id.',
        changedPaths: ['packages/extension-sdk/src/manifest.ts'],
        hash: 'a1b2c3d4',
        parentHashes: ['parent'],
        subject: 'feat(extension-sdk)!: require extension ids',
      },
      {
        body: '',
        changedPaths: ['.github/workflows/ci.yml'],
        hash: 'e5f6a7b8',
        parentHashes: ['parent'],
        subject: 'ci(release): dispatch validation for release pull requests',
      },
      {
        body: '',
        changedPaths: ['packages/extension-sdk/src/manifest.ts'],
        hash: 'c9d0e1f2',
        parentHashes: ['parent'],
        subject: 'revert(extension-sdk): restore optional extension ids',
      },
      {
        /*
         * `perf` is part of the Conventional Commits set and was missing from the allowed
         * types, so a legitimately named performance commit was rejected. It deliberately
         * does NOT carry package release intent (that stays feat/fix/revert), so a perf
         * commit touching a package still has to be accompanied by an intent-bearing title.
         */
        body: '',
        changedPaths: ['src/renderer/src/features/session-tree/lib/session-tree-filter.ts'],
        hash: 'b3c4d5e6',
        parentHashes: ['parent'],
        subject: 'perf(session-tree): single-pass filtering',
      },
    ])

    expect(violations).toEqual([])
  })

  it('reports invalid authored subjects with the commit hash', () => {
    const violations = validateConventionalCommitSubjects([
      {
        body: '',
        changedPaths: ['scripts/check-conventional-commits.ts'],
        hash: 'a1b2c3d4',
        parentHashes: ['parent'],
        subject: 'Implement commit validation',
      },
    ])

    expect(violations).toEqual([
      'a1b2c3d4: "Implement commit validation" is not an allowed Conventional Commit subject.',
    ])
  })

  it('only exempts generated merge subjects that do not affect publishable packages', () => {
    const violations = validateConventionalCommitSubjects([
      {
        body: '',
        changedPaths: ['src/main/index.ts'],
        hash: 'a1b2c3d4',
        parentHashes: ['first-parent', 'second-parent'],
        subject: 'Merge pull request #123 from OpenWaggle/release-please--branches--main',
      },
      {
        body: 'This reverts commit 0123456789012345678901234567890123456789.',
        changedPaths: ['src/main/index.ts'],
        hash: 'e5f6a7b8',
        parentHashes: ['parent'],
        subject: 'Revert "feat(extension-sdk): publish extension manifests"',
      },
      {
        body: '',
        changedPaths: ['packages/extension-sdk/src/manifest.ts'],
        hash: 'c9d0e1f2',
        parentHashes: ['first-parent', 'second-parent'],
        subject: 'Merge pull request #124 from OpenWaggle/package-change',
      },
    ])

    expect(violations).toEqual([
      'e5f6a7b8: "Revert \\"feat(extension-sdk): publish extension manifests\\"" is not an allowed Conventional Commit subject.',
      'c9d0e1f2: "Merge pull request #124 from OpenWaggle/package-change" affects a publishable package and must carry explicit Conventional Commit release intent.',
    ])
  })
})
