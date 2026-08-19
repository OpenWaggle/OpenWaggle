import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  it('commits a rename correctly from a subdirectory, given only the target path', async () => {
    const { repository } = await createRepositoryWithWorktree()
    const nested = path.join(repository, 'packages', 'app')
    await mkdir(nested, { recursive: true })
    await writeFile(path.join(nested, 'kept.txt'), 'keep\n')
    // A filename whose glob syntax must not reach its sibling.
    await writeFile(path.join(repository, 'file[ab].txt'), 'bracketed\n')
    await writeFile(path.join(repository, 'filea.txt'), 'sibling\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'add files'])

    await git(repository, ['mv', 'packages/app/kept.txt', 'packages/app/moved.txt'])
    await writeFile(path.join(repository, 'file[ab].txt'), 'edited\n')
    await writeFile(path.join(repository, 'filea.txt'), 'must not be committed\n')

    // The project path is the opened subdirectory; the selection names only the rename's target.
    const result = await commitGit(nested, {
      message: 'move and edit',
      amend: false,
      paths: ['packages/app/moved.txt', 'file[ab].txt'],
    })

    expect(result.ok).toBe(true)
    const tracked = await git(repository, ['ls-tree', '-r', '--name-only', 'HEAD'])
    expect(tracked).toContain('packages/app/moved.txt')
    expect(tracked).not.toContain('packages/app/kept.txt')
    const committed = await git(repository, ['show', '--name-only', '--format=', 'HEAD'])
    expect(committed).toContain('file[ab].txt')
    /*
     * The glob-looking pathspec must not have reached the sibling. Asserted on the *index*, not on
     * `git status`: staging `filea.txt` without committing it leaves it in the status output either way, so
     * only an empty index proves the pathspec stayed literal.
     */
    expect(await git(repository, ['show', '--name-only', '--format=', 'HEAD'])).not.toContain(
      'filea.txt',
    )
    expect((await git(repository, ['diff', '--cached', '--name-only'])).trim()).toBe('')
    expect(await git(repository, ['status', '--porcelain=v1'])).toContain('filea.txt')
  })

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

  /**
   * The rename source is added to the commit so the deletion is covered - but only while nothing occupies
   * that path. `git commit -- <paths>` commits the *working tree* content of the paths it is given, so a new
   * file the user created at the old name would be committed too, and staging it first also destroyed the
   * rename record in the index. Both were verified against real git. When the path is occupied there is no
   * deletion left to express, and the honest commit is the target alone.
   */
  it('does not commit an unselected file left at a rename source path', async () => {
    const { repository } = await createRepositoryWithWorktree()
    await writeFile(path.join(repository, 'old.txt'), 'original\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'add old'])

    await git(repository, ['mv', 'old.txt', 'new.txt'])
    // The user creates something new at the old name and does NOT select it.
    await writeFile(path.join(repository, 'old.txt'), 'unselected secret\n')

    const result = await commitGit(repository, {
      message: 'move the file',
      amend: false,
      paths: ['new.txt'],
    })

    expect(result.ok).toBe(true)
    const committed = await git(repository, ['show', '--name-only', '--format=', 'HEAD'])
    expect(committed).toContain('new.txt')
    expect(committed).not.toContain('old.txt')
    expect((await git(repository, ['show', 'HEAD:old.txt'])).trim()).toBe('original')
    // Still the user's to deal with, and still their content.
    expect(await readFile(path.join(repository, 'old.txt'), 'utf8')).toBe('unselected secret\n')
  })

  /**
   * A directory where a rename started is the same question with a worse failure: staging that path swept in
   * everything under it, and a pathspec naming it could fail the whole commit.
   */
  it('commits a rename when a directory occupies the source path', async () => {
    const { repository } = await createRepositoryWithWorktree()
    await writeFile(path.join(repository, 'notes.txt'), 'notes\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'add notes'])

    await git(repository, ['mv', 'notes.txt', 'notes-moved.txt'])
    await mkdir(path.join(repository, 'notes.txt'), { recursive: true })
    await writeFile(path.join(repository, 'notes.txt', 'inside.txt'), 'unselected\n')

    const result = await commitGit(repository, {
      message: 'move notes',
      amend: false,
      paths: ['notes-moved.txt'],
    })

    expect(result.ok).toBe(true)
    const committed = await git(repository, ['show', '--name-only', '--format=', 'HEAD'])
    expect(committed).toContain('notes-moved.txt')
    expect(committed).not.toContain('inside.txt')
  })

  /**
   * `git status` reports a copy with the same `old -> new` shape as a rename when `status.renames=copies`, but
   * a copy's source is not deleted - so committing it would commit a file the user did not select. The
   * occupancy check settles this for the same reason it settles a re-created rename source.
   */
  it('does not commit a copy source', async () => {
    const { repository } = await createRepositoryWithWorktree()
    await git(repository, ['config', 'status.renames', 'copies'])
    await writeFile(path.join(repository, 'template.txt'), 'shared body\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'add template'])

    await writeFile(path.join(repository, 'copy.txt'), 'shared body\n')
    // The source is edited but NOT selected.
    await writeFile(path.join(repository, 'template.txt'), 'shared body\nedited\n')

    const result = await commitGit(repository, {
      message: 'add a copy',
      amend: false,
      paths: ['copy.txt'],
    })

    expect(result.ok).toBe(true)
    const committed = await git(repository, ['show', '--name-only', '--format=', 'HEAD'])
    expect(committed).toContain('copy.txt')
    expect(committed).not.toContain('template.txt')
  })
})
