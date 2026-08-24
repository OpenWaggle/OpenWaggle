import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/*
 * commit-handler reaches Electron transitively through the status cache. Only the
 * committing behaviour is under test here, so the app surfaces it touches are stubbed.
 */
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getName: () => 'openwaggle-test' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

const { commitGit } = await import('../commit-handler')
const { execFileAsync } = await import('../shared')

let repositoryPath: string | null = null

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd })
  return typeof result === 'string' ? result : (result.stdout ?? '')
}

async function headSubject(cwd: string): Promise<string> {
  return (await git(cwd, ['log', '-1', '--pretty=%s'])).trim()
}

async function createRepositoryWithWorktree(): Promise<{
  readonly repository: string
  readonly worktree: string
}> {
  const repository = await mkdtemp(path.join(tmpdir(), 'openwaggle-commit-worktree-'))
  repositoryPath = repository
  await git(repository, ['init', '--initial-branch=main'])
  await git(repository, ['config', 'user.name', 'OpenWaggle Test'])
  await git(repository, ['config', 'user.email', 'openwaggle@example.test'])
  await writeFile(path.join(repository, 'seed.txt'), 'seed\n')
  await git(repository, ['add', '--all'])
  await git(repository, ['commit', '-m', 'Initial commit'])

  // A linked worktree, laid out as a Session worktree is: a sibling directory on its
  // own branch, sharing the repository's refs.
  const worktree = path.join(repository, '..', `${path.basename(repository)}-wt`)
  await git(repository, ['worktree', 'add', '-b', 'ow/session-test', worktree, 'main'])
  return { repository, worktree }
}

afterEach(async () => {
  if (repositoryPath === null) return
  const worktree = path.join(repositoryPath, '..', `${path.basename(repositoryPath)}-wt`)
  await git(repositoryPath, ['worktree', 'remove', '--force', worktree]).catch(() => undefined)
  await rm(repositoryPath, { recursive: true, force: true })
  await rm(worktree, { recursive: true, force: true }).catch(() => undefined)
  repositoryPath = null
})
describe('commitGit against a linked worktree', () => {
  /**
   * The blocking defect this pins: the header committed to the opened checkout while a
   * worktree-mode session was active, so a user who reviewed the agent's changes in the
   * Session worktree would have had the commit land in their own checkout instead.
   *
   * Asserted against real git rather than a mock, because the risk is not only which
   * argument the renderer passes but whether the commit actually lands in that tree.
   */
  it('commits into the worktree and leaves the opened checkout untouched', async () => {
    const { repository, worktree } = await createRepositoryWithWorktree()
    const checkoutHeadBefore = await headSubject(repository)
    await writeFile(path.join(worktree, 'agent-work.txt'), 'agent output\n')
    await git(worktree, ['add', '--all'])

    const result = await commitGit(worktree, { message: 'agent work', amend: false, paths: [] })

    expect(result.ok).toBe(true)
    expect(await headSubject(worktree)).toBe('agent work')
    expect(await headSubject(repository)).toBe(checkoutHeadBefore)
  })

  /**
   * The committed content must be the worktree's, not merely a commit object created in
   * the right place: a commit that recorded the checkout's tree would still be wrong.
   */
  it('records the file that exists only in the worktree', async () => {
    const { repository, worktree } = await createRepositoryWithWorktree()
    await writeFile(path.join(worktree, 'only-here.txt'), 'worktree only\n')
    await git(worktree, ['add', '--all'])

    await commitGit(worktree, { message: 'add worktree file', amend: false, paths: [] })

    const committed = await git(worktree, ['show', '--name-only', '--pretty=format:', 'HEAD'])
    expect(committed).toContain('only-here.txt')
    // The branch the checkout has out must not contain it.
    const checkoutFiles = await git(repository, ['ls-tree', '-r', '--name-only', 'HEAD'])
    expect(checkoutFiles).not.toContain('only-here.txt')
  })

  /**
   * The commit set includes both paths of a rename, so the commit covers the deletion rather than keeping
   * both files. Two real git behaviours make that awkward, and this pins both:
   *
   * - a path gone from disk is refused by a plain `git add --`, so `-A` is needed for a deletion and for an
   *   unstaged rename's source;
   * - an *already staged* rename's source is gone from disk **and** from the index, so it matches nothing
   *   for `add` - yet it must stay in the commit pathspec, or the commit keeps both files and leaves the
   *   deletion staged. Batching makes that fatal (`add -A -- kept.txt moved.txt` exits 128), so staging is
   *   per-path and an unmatched entry is skipped.
   */
  /**
   * Everything a correct commit needs is settled inside `commitGit`, because there is more than one way in -
   * the diff panel's stacked action and the header's Commit dialog - and each had a different subset right.
   * This asserts the three properties a caller must not have to know about, from a caller that passes the
   * plainest possible selection: target paths only, and a subdirectory as the project path.
   */

  /**
   * The first commit in a repository has no parent, and `git diff-tree HEAD` lists nothing for such a commit
   * unless asked with `--root`. The verification therefore read every root commit as a total omission: it was
   * created, rolled back, and reported as a failure - so a new project could never make its first commit.
   */
  it('accepts the first commit in a repository', async () => {
    const { repository } = await createRepositoryWithWorktree()
    const fresh = path.join(repository, 'fresh-project')
    await mkdir(fresh, { recursive: true })
    await git(fresh, ['init', '-b', 'main', '.'])
    await git(fresh, ['config', 'user.email', 'tests@openwaggle.ai'])
    await git(fresh, ['config', 'user.name', 'OpenWaggle Tests'])
    await writeFile(path.join(fresh, 'first.txt'), 'hello\n')

    const result = await commitGit(fresh, {
      message: 'first commit',
      amend: false,
      paths: ['first.txt'],
    })

    expect(result.ok).toBe(true)
    expect(await git(fresh, ['ls-tree', '-r', '--name-only', 'HEAD'])).toContain('first.txt')
  })

  /**
   * A rebase or cherry-pick leaves conflicts without writing `MERGE_HEAD`, and this is a *pathspec* commit -
   * which git permits with unmerged entries where it refuses a whole-index one. Staging then marked the conflict
   * resolved with the markers still in the file, and the commit either recorded them and reported success, or
   * failed after the three-stage entry was already gone so the markers looked like the user's own resolution.
   */
  /**
   * The same guard, asked from an opened subdirectory. `git ls-files --unmerged` is scoped to the directory it runs
   * in, so a conflict anywhere outside that subdirectory was invisible: the guard passed, staging marked the
   * conflict resolved with the markers still in the file, and the commit recorded them and reported success.
   */
  it('refuses a commit from a subdirectory while a conflict exists elsewhere', async () => {
    const { repository } = await createRepositoryWithWorktree()
    const nested = path.join(repository, 'packages', 'app')
    await mkdir(nested, { recursive: true })
    await writeFile(path.join(nested, 'own.txt'), 'own\n')
    await writeFile(path.join(repository, 'f.txt'), 'base\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'base'])
    await git(repository, ['checkout', '-b', 'side'])
    await writeFile(path.join(repository, 'f.txt'), 'side\n')
    await git(repository, ['commit', '-am', 'side'])
    await git(repository, ['checkout', 'main'])
    await writeFile(path.join(repository, 'f.txt'), 'main\n')
    await git(repository, ['commit', '-am', 'main'])
    await git(repository, ['rebase', 'side']).catch(() => undefined)
    await writeFile(path.join(nested, 'own.txt'), 'edited\n')

    const result = await commitGit(nested, {
      message: 'commit from the subdirectory',
      amend: false,
      paths: ['packages/app/own.txt'],
    })

    expect(result).toMatchObject({ ok: false, code: 'merge-in-progress' })
    expect(await git(repository, ['ls-files', '--unmerged'])).toContain('f.txt')
  })

  it('refuses to commit while a rebase conflict is unresolved', async () => {
    const { repository } = await createRepositoryWithWorktree()
    await writeFile(path.join(repository, 'f.txt'), 'base\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'base'])
    await git(repository, ['checkout', '-b', 'side'])
    await writeFile(path.join(repository, 'f.txt'), 'side\n')
    await git(repository, ['commit', '-am', 'side'])
    await git(repository, ['checkout', 'main'])
    await writeFile(path.join(repository, 'f.txt'), 'main\n')
    await git(repository, ['commit', '-am', 'main'])
    await git(repository, ['rebase', 'side']).catch(() => undefined)

    // No MERGE_HEAD here, which is exactly why the old check missed it.
    await expect(git(repository, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).rejects.toThrow()

    const result = await commitGit(repository, {
      message: 'commit during a rebase',
      amend: false,
      paths: ['f.txt'],
    })

    expect(result).toMatchObject({ ok: false, code: 'merge-in-progress' })
    // The three-stage entry is intact, so the conflict is still the user's to resolve.
    expect(await git(repository, ['ls-files', '--unmerged'])).toContain('f.txt')
  })
})
