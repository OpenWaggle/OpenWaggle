import { execFile as execFileCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { validateConventionalCommits } from '../check-conventional-commits'

const execFile = promisify(execFileCallback)
const POLICY_SCRIPT_PATH = 'scripts/check-conventional-commits.ts'
const GIT_IDENTITY = [
  '-c',
  'user.name=OpenWaggle Tests',
  '-c',
  'user.email=tests@openwaggle.ai',
] as const

async function git(cwd: string, args: readonly string[]) {
  const { stdout } = await execFile('git', args, { cwd })
  return stdout.trim()
}

async function writeAndCommit(
  cwd: string,
  filePath: string,
  contents: string,
  message: string,
) {
  const absolutePath = path.join(cwd, filePath)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, contents, 'utf8')
  await git(cwd, ['add', filePath])
  await git(cwd, [...GIT_IDENTITY, 'commit', '-m', message])
  return git(cwd, ['rev-parse', 'HEAD'])
}

async function createRepository() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-commit-policy-'))
  await git(cwd, ['init', '-b', 'main'])
  await writeAndCommit(cwd, 'history.txt', 'history\n', 'historical commit')
  const baseline = await writeAndCommit(
    cwd,
    POLICY_SCRIPT_PATH,
    'current policy marker\n',
    'ci: introduce commit policy',
  )
  return { baseline, cwd }
}

async function merge(cwd: string, branch: string, message: string) {
  await git(cwd, [...GIT_IDENTITY, 'merge', '--no-ff', branch, '-m', message])
  return git(cwd, ['rev-parse', 'HEAD'])
}

describe('Conventional Commit PR title release intent', () => {
  it('does not demand release intent in the PR title for an exempt sync merge', async () => {
    /*
     * The exemption previously covered only the commit-level rule, so the merge commit passed while
     * the PR *title* was still required to carry release intent for `packages/` changes that were
     * already released on the base branch and were never this PR's to bump.
     */
    const { baseline, cwd } = await createRepository()
    try {
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/package.json',
        '{"version":"0.2.0"}\n',
        'fix(extension-sdk): update package metadata',
      )
      const baseRef = await git(cwd, ['rev-parse', 'HEAD'])

      await git(cwd, ['checkout', '-b', 'feature', baseline])
      await writeAndCommit(cwd, 'src/feature.ts', 'export {}\n', 'feat(app): add a feature')
      const updateMerge = await merge(cwd, 'main', "Merge branch 'main' into feature")

      const result = await validateConventionalCommits({
        baseline,
        cwd,
        from: baseRef,
        to: updateMerge,
        // A title with no release intent: `docs:` never triggers a Release Please bump.
        prTitle: 'docs(app): describe the feature',
      })

      expect(result.violations).toEqual([])
    } finally {
      await fs.rm(cwd, { force: true, recursive: true })
    }
  })

  it('still demands release intent in the PR title for the branch\'s own package change', async () => {
    const { baseline, cwd } = await createRepository()
    try {
      const baseRef = await git(cwd, ['rev-parse', 'HEAD'])
      await git(cwd, ['checkout', '-b', 'feature'])
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/index.ts',
        'export {}\n',
        'feat(extension-sdk): add an export',
      )
      const head = await git(cwd, ['rev-parse', 'HEAD'])

      const result = await validateConventionalCommits({
        baseline,
        cwd,
        from: baseRef,
        to: head,
        prTitle: 'docs(app): describe the feature',
      })

      expect(result.violations).toHaveLength(1)
      expect(result.violations[0]).toContain('would not create a Release Please version bump')
    } finally {
      await fs.rm(cwd, { force: true, recursive: true })
    }
  })

  it('refuses an evil merge that introduces an unreleased package change', async () => {
    /*
     * A merge's tree is not constrained by its parents: content added while resolving a conflict
     * exists in neither side. Exempting the whole commit on parent containment alone dropped such a
     * `packages/` change from both the commit rule and this PR-title rule, so a change to the
     * published npm surface could reach the base branch with no version bump and no changelog entry.
     * A regression against main, which had no exemption on this rule at all.
     */
    const { baseline, cwd } = await createRepository()
    try {
      await writeAndCommit(cwd, 'base-notes.md', 'notes\n', 'docs: base branch moves on')
      const baseRef = await git(cwd, ['rev-parse', 'HEAD'])

      await git(cwd, ['checkout', '-b', 'feature', baseline])
      await writeAndCommit(cwd, 'src/feature.ts', 'export {}\n', 'feat(app): add a feature')
      await merge(cwd, 'main', "Merge branch 'main' into feature")

      // The package change exists only in the merge commit: no parent has it, nothing released it.
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/smuggled.ts',
        'export {}\n',
        'chore: amend marker',
      )
      await git(cwd, [...GIT_IDENTITY, 'reset', '--soft', 'HEAD~1'])
      await git(cwd, [...GIT_IDENTITY, 'commit', '--amend', '--no-edit'])
      const evilMerge = await git(cwd, ['rev-parse', 'HEAD'])

      const result = await validateConventionalCommits({
        baseline,
        cwd,
        from: baseRef,
        to: evilMerge,
        prTitle: 'docs(app): describe the feature',
      })

      expect(result.violations.join(' ')).toContain('would not create a Release Please version bump')
    } finally {
      await fs.rm(cwd, { force: true, recursive: true })
    }
  })

  it('refuses a merge that reverts a published package to an older released state', async () => {
    /*
     * The adversarial shape an earlier version of this exemption passed. A combined diff omits a path
     * whenever the merge result matches *any* parent, and containment accepts any ancestor of the
     * base - so merging an old released commit and resolving a published file back to that older
     * content produced an empty combined diff and sailed through both rules. What the exemption
     * actually needs to know is whether the base already holds this content.
     */
    const { baseline, cwd } = await createRepository()
    try {
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/index.ts',
        'export const v = 2\n',
        'fix(extension-sdk): release v2',
      )
      const oldReleased = await git(cwd, ['rev-parse', 'HEAD'])
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/index.ts',
        'export const v = 3\n',
        'fix(extension-sdk): release v3',
      )
      const baseRef = await git(cwd, ['rev-parse', 'HEAD'])

      await git(cwd, ['checkout', '-b', 'feature', baseline])
      await writeAndCommit(cwd, 'src/feature.ts', 'export {}\n', 'feat(app): add a feature')
      // Merge an old released commit, keeping the published file at that older content.
      await git(cwd, [...GIT_IDENTITY, 'merge', '--no-ff', '--no-commit', oldReleased]).catch(
        () => undefined,
      )
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/index.ts',
        'export const v = 2\n',
        "Merge branch 'old' into feature",
      )
      const evilMerge = await git(cwd, ['rev-parse', 'HEAD'])

      const result = await validateConventionalCommits({
        baseline,
        cwd,
        from: baseRef,
        to: evilMerge,
        prTitle: 'docs(app): describe the feature',
      })

      expect(result.violations.length).toBeGreaterThan(0)
    } finally {
      await fs.rm(cwd, { force: true, recursive: true })
    }
  })

  it('demands release intent when a merge reverts a released package file', async () => {
    /*
     * A merge's paths are read against its *first* parent, so a merge resolved to keep the branch's own
     * older copy of a published file reported no `packages/` path at all - while relative to the base the
     * PR reverts a released change. Every per-commit rule exempted it. Asked against the base instead,
     * the answer is unambiguous.
     */
    const { baseline, cwd } = await createRepository()
    try {
      // Released once on the base, before the branch forks: the branch inherits v = 1.
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/index.ts',
        'export const v = 1\n',
        'fix(extension-sdk): release v1',
      )
      const forkPoint = await git(cwd, ['rev-parse', 'HEAD'])
      // The branch itself never touches the package.
      await git(cwd, ['checkout', '-b', 'feature', forkPoint])
      await writeAndCommit(cwd, 'src/feature.ts', 'export {}\n', 'feat(app): unrelated work')
      await git(cwd, ['checkout', 'main'])
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/index.ts',
        'export const v = 2\n',
        'fix(extension-sdk): release v2',
      )
      const baseRef = await git(cwd, ['rev-parse', 'HEAD'])

      // Merge the base, resolving the published file back to the branch's older content.
      await git(cwd, ['checkout', 'feature'])
      await git(cwd, [...GIT_IDENTITY, 'merge', '--no-ff', '--no-commit', 'main']).catch(
        () => undefined,
      )
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/index.ts',
        'export const v = 1\n',
        "Merge branch 'main' into feature",
      )
      const head = await git(cwd, ['rev-parse', 'HEAD'])

      const result = await validateConventionalCommits({
        baseline,
        cwd,
        from: baseRef,
        to: head,
        prTitle: 'docs(app): describe the feature',
      })

      expect(result.violations.join(' ')).toContain('would not create a Release Please version bump')
    } finally {
      await fs.rm(cwd, { force: true, recursive: true })
    }
  })

  it('does not demand release intent from a PR that touches no package when the base moves ahead', async () => {
    /*
     * The PR-level check was a two-dot diff, which is symmetric: once the base branch gained a `packages/`
     * commit the PR had not merged, it reported that path in the reverse direction and demanded release
     * intent from a PR that never touched a package. That would have blocked every PR here as soon as a
     * release landed. Verified against real git that a three-dot diff reports nothing for this shape.
     */
    const { baseline, cwd } = await createRepository()
    try {
      await git(cwd, ['checkout', '-b', 'feature', baseline])
      await writeAndCommit(cwd, 'src/feature.ts', 'export {}\n', 'docs(app): document a thing')
      const head = await git(cwd, ['rev-parse', 'HEAD'])

      // The base branch releases a package change the PR has not merged.
      await git(cwd, ['checkout', 'main'])
      await writeAndCommit(
        cwd,
        'packages/extension-sdk/index.ts',
        'export const v = 2\n',
        'fix(extension-sdk): release v2',
      )
      const baseRef = await git(cwd, ['rev-parse', 'HEAD'])

      const result = await validateConventionalCommits({
        baseline,
        cwd,
        from: baseRef,
        to: head,
        prTitle: 'docs(app): document a thing',
      })

      expect(result.violations).toEqual([])
    } finally {
      await fs.rm(cwd, { force: true, recursive: true })
    }
  })
})
