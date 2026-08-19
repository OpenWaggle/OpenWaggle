import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// commit-handler reaches Electron transitively through the status cache; only committing is under test.
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getName: () => 'openwaggle-test' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

const { commitGit } = await import('../commit-handler')
const { createRepositoryWithWorktree, filesystemConflatesCase, git } = await import(
  './commit.test-harness'
)

describe('commitGit and renames', () => {
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

  it('does not commit a symlink left at a rename source path', async () => {
    /*
     * A broken symlink is still something the user put there, and `stat` reports it as absent - so the source
     * was expanded into the commit and the symlink committed without being selected. The occupancy check does
     * not follow links.
     */
    const { repository } = await createRepositoryWithWorktree()
    await writeFile(path.join(repository, 'src.txt'), 'body\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'add src'])

    await git(repository, ['mv', 'src.txt', 'dst.txt'])
    await symlink('/nonexistent/target', path.join(repository, 'src.txt'))

    const result = await commitGit(repository, {
      message: 'move src',
      amend: false,
      paths: ['dst.txt'],
    })

    expect(result.ok).toBe(true)
    const committed = await git(repository, ['show', '--name-only', '--format=', 'HEAD'])
    expect(committed).toContain('dst.txt')
    expect(committed).not.toContain('src.txt')
  })

  /**
   * A case-only rename cannot be committed through a pathspec on a case-insensitive filesystem: git refuses
   * with "will not add file alias", because a pathspec commit rebuilds those entries from the working tree and
   * finds the other spelling already in the index. Committing the whole index would work but would sweep in
   * whatever the user staged themselves, so this reports what happened rather than passing a raw fatal through
   * as an unknown failure. Skipped where the filesystem is case-sensitive, since there is nothing to refuse.
   */
  it('explains a case-only rename it cannot commit', async () => {
    const { repository } = await createRepositoryWithWorktree()
    if (!(await filesystemConflatesCase(repository))) {
      // A case-sensitive filesystem has nothing to refuse: this is an ordinary rename there.
      return
    }
    await writeFile(path.join(repository, 'readme.md'), 'body\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'add readme'])
    await git(repository, ['mv', 'readme.md', 'README.md'])

    const result = await commitGit(repository, {
      message: 'rename for case',
      amend: false,
      paths: ['README.md'],
    })

    expect(result).toMatchObject({ ok: false, code: 'case-only-rename' })
    expect(result.ok ? '' : result.message).toContain('letter case')
  })

  /**
   * A case-only *directory* component is worse than a case-only file rename, and used to pass silently: git's
   * pathspec matching resolves the new spelling onto the old index entry, `add` and `commit` both exit 0, and
   * the rename is left out of the commit while staying staged - so the commit reported success while omitting
   * the change, and the stacked action would have pushed it. Verified against real git.
   */
  it('refuses a case-only directory rename rather than committing without it', async () => {
    const { repository } = await createRepositoryWithWorktree()
    if (!(await filesystemConflatesCase(repository))) return
    await mkdir(path.join(repository, 'Utils'), { recursive: true })
    await writeFile(path.join(repository, 'Utils', 'helper.ts'), 'export {}\n')
    await writeFile(path.join(repository, 'app.ts'), 'import "./Utils/helper"\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'add helper'])

    await mkdir(path.join(repository, 'utils'), { recursive: true })
    await git(repository, ['mv', 'Utils/helper.ts', 'utils/helper.ts'])
    await writeFile(path.join(repository, 'app.ts'), 'import "./utils/helper"\n')

    const result = await commitGit(repository, {
      message: 'lowercase the directory',
      amend: false,
      paths: ['utils/helper.ts', 'app.ts'],
    })

    expect(result).toMatchObject({ ok: false, code: 'case-only-rename' })
    // Nothing was committed, so the change is still the user's to make.
    expect((await git(repository, ['log', '--format=%s', '-1'])).trim()).toBe('add helper')
  })
})
