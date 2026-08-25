import fs from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { validateConventionalCommits } from '../check-conventional-commits'
import { createRepository, git, merge, writeAndCommit } from './commit-policy.test-harness'

describe('Conventional Commit release-sync attribution', () => {
  it('keeps exempting the sync merge after the base releases the same file again', async () => {
    /*
     * The exemption compared the merge's blobs against the base *tip*, which moves. A sync merge that
     * legitimately brought release 0.2.0 stopped matching the moment the base released 0.3.0 of the same
     * file - which is every release, since release-please rewrites `package.json` and `CHANGELOG.md` each
     * time. The PR was then permanently blocked by a commit-level violation that no title can satisfy, and
     * re-syncing only added another such merge. The merge's own parents cannot move, so they are asked too.
     */
    const { baseline, cwd } = await createRepository()
    try {
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/package.json',
        '{"version":"0.2.0"}\n',
        'fix(extension-sdk): release 0.2.0',
      )

      await git(cwd, ['checkout', '-b', 'feature', baseline])
      await writeAndCommit(cwd, 'src/feature.ts', 'export {}\n', 'feat(app): add a feature')
      const syncMerge = await merge(cwd, 'main', "Merge branch 'main' into feature")

      // The base releases the SAME file again, exactly as release-please does on every release.
      await git(cwd, ['checkout', 'main'])
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/package.json',
        '{"version":"0.3.0"}\n',
        'fix(extension-sdk): release 0.3.0',
      )
      const advancedBaseRef = await git(cwd, ['rev-parse', 'HEAD'])
      await git(cwd, ['checkout', 'feature'])

      const result = await validateConventionalCommits({
        baseline,
        cwd,
        from: advancedBaseRef,
        to: syncMerge,
        prTitle: 'feat(app): add a feature',
      })

      expect(result.violations).toEqual([])
    } finally {
      await fs.rm(cwd, { force: true, recursive: true })
    }
  })
})
