import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { getGitBranchDiff } from '../status-service'

const execFileAsync = promisify(execFile)

/**
 * The diff panel's "Automatic" base ref sends an empty string. It used to fall through to the
 * working-tree diff, making the Branch scope a silent duplicate of the Working tree scope
 * while the label promised a decision (#157). These drive real Git so the resolution order is
 * exercised rather than mocked.
 *
 * Every repository pins `init.defaultBranch` locally. Resolution consults that setting, and a
 * developer machine usually has it set globally while a fresh CI runner does not - an earlier
 * version of this file passed locally and failed in CI for exactly that reason.
 */
let repositoryPath: string | null = null

async function git(cwd: string, args: readonly string[]) {
  await execFileAsync('git', [...args], { cwd })
}

async function commitFile(cwd: string, file: string, contents: string, message: string) {
  await writeFile(path.join(cwd, file), contents, 'utf8')
  await git(cwd, ['add', file])
  await git(cwd, ['commit', '-m', message])
}

async function createRepository(options?: { readonly branch?: string }) {
  const branch = options?.branch ?? 'main'
  const created = await mkdtemp(path.join(tmpdir(), 'openwaggle-automatic-base-'))
  repositoryPath = created
  await git(created, ['init', '-b', branch])
  await git(created, ['config', 'user.name', 'OpenWaggle Test'])
  await git(created, ['config', 'user.email', 'openwaggle@example.test'])
  /*
   * A misleading `init.defaultBranch` is set on purpose. Resolution must ignore it: the setting
   * describes how *new* repositories are initialised, `git config --get` reads it from global and
   * system config, and a repository created with `git init -b develop` therefore reported a
   * developer's global `main`. Automatic would have diffed against the wrong branch silently.
   */
  await git(created, ['config', 'init.defaultBranch', 'configured-but-irrelevant'])
  await commitFile(created, 'base.txt', 'base\n', 'chore: baseline')
  return created
}

function changedPaths(result: Awaited<ReturnType<typeof getGitBranchDiff>>) {
  return result.ok ? result.files.map((file) => file.path).sort() : []
}

afterEach(async () => {
  if (repositoryPath) await rm(repositoryPath, { recursive: true, force: true })
  repositoryPath = null
})

describe('Automatic base ref resolution', () => {
  it('prefers the remote-tracking default branch', async () => {
    const cwd = await createRepository()
    const remote = await mkdtemp(path.join(tmpdir(), 'openwaggle-automatic-base-remote-'))
    try {
      await git(remote, ['init', '--bare', '-b', 'main'])
      await git(cwd, ['remote', 'add', 'origin', remote])
      await git(cwd, ['push', '-u', 'origin', 'main'])
      await git(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])

      // Advance local main only. origin/main stays at the baseline, so resolving against the
      // remote-tracking ref includes this commit while resolving locally would not.
      await commitFile(cwd, 'local-only.txt', 'local\n', 'feat: local advance')

      const automatic = await getGitBranchDiff(cwd, '')

      expect(automatic.ok).toBe(true)
      expect(changedPaths(automatic)).toEqual(['local-only.txt'])
    } finally {
      await rm(remote, { recursive: true, force: true })
    }
  })

  it('asks the remote which branch is default when the local symref is missing', async () => {
    /*
     * A clone sets refs/remotes/origin/HEAD, but plenty of repositories lack it. Verified that
     * `ls-remote --symref origin HEAD` still reports `refs/heads/develop` there, which is
     * authoritative - unlike a conventional guess or a global config setting.
     */
    const cwd = await createRepository({ branch: 'develop' })
    const remote = await mkdtemp(path.join(tmpdir(), 'openwaggle-automatic-base-remote-'))
    try {
      await git(remote, ['init', '--bare', '-b', 'develop'])
      await git(cwd, ['remote', 'add', 'origin', remote])
      await git(cwd, ['push', '-u', 'origin', 'develop'])
      // Deliberately no `symbolic-ref refs/remotes/origin/HEAD`.
      await git(cwd, ['checkout', '-b', 'feature'])
      await commitFile(cwd, 'on-feature.txt', 'feature\n', 'feat: add feature file')
      // An uncommitted change must NOT appear: a branch diff is commits, not the working tree.
      await writeFile(path.join(cwd, 'base.txt'), 'edited\n', 'utf8')

      const automatic = await getGitBranchDiff(cwd, '')

      expect(automatic.ok).toBe(true)
      expect(changedPaths(automatic)).toEqual(['on-feature.txt'])
      expect(automatic.ok && automatic.resolvedBaseRef).toBe('origin/develop')
    } finally {
      await rm(remote, { recursive: true, force: true })
    }
  })

  it('does not diff against a conventional branch when the remote names a different default', async () => {
    /*
     * The failure this prevents: a repository whose real default is `develop` also has a `main`
     * branch lying around. Trying conventional names before consulting the remote would diff
     * against `main` and report nothing about the choice.
     */
    const cwd = await createRepository({ branch: 'develop' })
    const remote = await mkdtemp(path.join(tmpdir(), 'openwaggle-automatic-base-remote-'))
    try {
      await git(remote, ['init', '--bare', '-b', 'develop'])
      await git(cwd, ['remote', 'add', 'origin', remote])
      await git(cwd, ['push', '-u', 'origin', 'develop'])
      // A stale `main` that must not win.
      await git(cwd, ['branch', 'main'])
      await git(cwd, ['checkout', '-b', 'feature'])
      await commitFile(cwd, 'only-on-feature.txt', 'x\n', 'feat: commit on feature')

      const automatic = await getGitBranchDiff(cwd, '')

      expect(automatic.ok && automatic.resolvedBaseRef).toBe('origin/develop')
    } finally {
      await rm(remote, { recursive: true, force: true })
    }
  })

  it('reports no changes when HEAD is the default branch itself', async () => {
    /*
     * The common case, and previously untested: on the default branch the base and HEAD are the
     * same commit, so a three-dot diff is legitimately empty. Worth pinning because it looks
     * identical to a failure, and because it is the state most users open the Branch tab in.
     */
    const cwd = await createRepository({ branch: 'main' })
    await commitFile(cwd, 'on-main.txt', 'main\n', 'feat: commit straight onto main')

    const automatic = await getGitBranchDiff(cwd, '')

    expect(automatic.ok).toBe(true)
    expect(changedPaths(automatic)).toEqual([])
    expect(automatic.ok && automatic.resolvedBaseRef).toBe('main')
  })

  it('falls back to a conventional default branch that exists locally', async () => {
    // A local-only repository advertises nothing, so the conventional name is all there is.
    const cwd = await createRepository({ branch: 'main' })
    await git(cwd, ['checkout', '-b', 'feature'])
    await commitFile(cwd, 'conventional.txt', 'x\n', 'feat: commit on feature')

    const automatic = await getGitBranchDiff(cwd, '')

    expect(automatic.ok).toBe(true)
    expect(changedPaths(automatic)).toEqual(['conventional.txt'])
  })

  it('falls back to the working-tree diff when no default branch exists', async () => {
    // No remote, no configured default, and no conventional main/master to fall back to.
    const cwd = await createRepository({ branch: 'trunk' })
    await writeFile(path.join(cwd, 'base.txt'), 'base changed\n', 'utf8')

    const automatic = await getGitBranchDiff(cwd, '')

    expect(automatic.ok).toBe(true)
    // The uncommitted edit is the only honest answer when there is no base to compare to.
    expect(changedPaths(automatic)).toEqual(['base.txt'])
  })

  it('still honours an explicitly chosen base ref', async () => {
    const cwd = await createRepository()
    await git(cwd, ['checkout', '-b', 'feature'])
    await commitFile(cwd, 'explicit.txt', 'feature\n', 'feat: feature commit')

    const explicit = await getGitBranchDiff(cwd, 'main')

    expect(explicit.ok).toBe(true)
    expect(changedPaths(explicit)).toEqual(['explicit.txt'])
  })

  it('does not fall back to a conventional branch when the remote named a different default', async () => {
    /*
     * The candidate list used to append `main`/`master` unconditionally, so a repository whose remote
     * says `develop` - but whose clone has no `develop` commit yet - was diffed against whatever
     * conventional branch existed, which is the "quietly compared against the wrong branch" failure
     * this whole area was about. The remote's answer is authoritative; when it is not resolvable
     * locally the working-tree diff is the honest fallback.
     */
    const cwd = await createRepository({ branch: 'main' })
    const remote = await mkdtemp(path.join(tmpdir(), 'openwaggle-automatic-base-remote-'))
    try {
      await git(remote, ['init', '--bare', '-b', 'develop'])
      await git(cwd, ['remote', 'add', 'origin', remote])
      // The remote advertises `develop`, which this clone has no commit for.
      await git(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop'])

      const automatic = await getGitBranchDiff(cwd, '')

      expect(automatic.ok).toBe(true)
      // Fell through to the working tree rather than diffing against the local `main`.
      expect(automatic.ok && automatic.automaticFellBackToWorkingTree).toBe(true)
      expect(automatic.ok && automatic.resolvedBaseRef).toBeUndefined()
    } finally {
      await rm(remote, { recursive: true, force: true })
    }
  })
})
