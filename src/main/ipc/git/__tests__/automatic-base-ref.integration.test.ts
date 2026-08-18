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

async function createRepository(options?: {
  readonly branch?: string
  readonly configuredDefault?: string
}) {
  const branch = options?.branch ?? 'main'
  const created = await mkdtemp(path.join(tmpdir(), 'openwaggle-automatic-base-'))
  repositoryPath = created
  await git(created, ['init', '-b', branch])
  await git(created, ['config', 'user.name', 'OpenWaggle Test'])
  await git(created, ['config', 'user.email', 'openwaggle@example.test'])
  // Pin the setting resolution reads, so ambient global config cannot change the outcome.
  await git(created, ['config', 'init.defaultBranch', options?.configuredDefault ?? branch])
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

  it('resolves the configured default branch when there is no remote', async () => {
    const cwd = await createRepository({ branch: 'trunk', configuredDefault: 'trunk' })
    await git(cwd, ['checkout', '-b', 'feature'])
    await commitFile(cwd, 'on-feature.txt', 'feature\n', 'feat: add feature file')
    // An uncommitted change must NOT appear: a branch diff is commits, not the working tree.
    await writeFile(path.join(cwd, 'base.txt'), 'edited\n', 'utf8')

    const automatic = await getGitBranchDiff(cwd, '')

    expect(automatic.ok).toBe(true)
    expect(changedPaths(automatic)).toEqual(['on-feature.txt'])
  })

  it('falls back to a conventional default branch that exists locally', async () => {
    // `git init -b main` sets no init.defaultBranch, so point it at a branch that does not
    // exist and let the conventional fallback find the real `main`.
    const cwd = await createRepository({ branch: 'main', configuredDefault: 'nonexistent' })
    await git(cwd, ['checkout', '-b', 'feature'])
    await commitFile(cwd, 'conventional.txt', 'x\n', 'feat: commit on feature')

    const automatic = await getGitBranchDiff(cwd, '')

    expect(automatic.ok).toBe(true)
    expect(changedPaths(automatic)).toEqual(['conventional.txt'])
  })

  it('falls back to the working-tree diff when no default branch exists', async () => {
    // No remote, no configured default, and no conventional main/master to fall back to.
    const cwd = await createRepository({ branch: 'trunk', configuredDefault: 'nonexistent' })
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
})
