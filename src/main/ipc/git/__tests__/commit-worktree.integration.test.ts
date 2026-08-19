import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  it('commits a staged rename and a deletion together', async () => {
    const { repository } = await createRepositoryWithWorktree()
    await writeFile(path.join(repository, 'kept.txt'), 'keep\n')
    await writeFile(path.join(repository, 'doomed.txt'), 'bye\n')
    await writeFile(path.join(repository, 'untouched.txt'), 'leave me\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'add files'])

    // A rename staged by git itself, an unstaged deletion, and an unrelated edit that must not be committed.
    await git(repository, ['mv', 'kept.txt', 'moved.txt'])
    await writeFile(path.join(repository, 'untouched.txt'), 'edited\n')
    const { rm: removeFile } = await import('node:fs/promises')
    await removeFile(path.join(repository, 'doomed.txt'))

    const result = await commitGit(repository, {
      message: 'move and delete',
      amend: false,
      paths: ['kept.txt', 'moved.txt', 'doomed.txt'],
    })

    expect(result.ok).toBe(true)
    const tracked = await git(repository, ['ls-tree', '-r', '--name-only', 'HEAD'])
    expect(tracked).toContain('moved.txt')
    expect(tracked).not.toContain('kept.txt')
    expect(tracked).not.toContain('doomed.txt')
    // Nothing of the rename is left staged, and the unrelated edit is still the user's to commit.
    const status = await git(repository, ['status', '--porcelain=v1'])
    expect(status).not.toContain('kept.txt')
    expect(status).toContain('untouched.txt')
  })
})
