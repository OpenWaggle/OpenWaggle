import { mkdir, writeFile } from 'node:fs/promises'
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

/**
 * How `commitGit` behaves when the filesystem folds letter case, which git's pathspec matching folds with it.
 *
 * These are pinned as documented behaviour, not as desired behaviour. Detecting the dangerous shapes was attempted three times by comparing path
 * strings and once by verifying the commit afterwards, and every attempt broke ordinary operations instead -
 * the first commit in a repository, an amend whose HEAD is a merge, the everyday amend that reverts part of the
 * previous commit. The conflated change stays visible in `git status` rather than being guarded by something
 * that refuses correct commits.
 */
describe('commitGit where the filesystem folds case', () => {
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
   * A case-only *directory* component: git's pathspec matching resolves the new spelling onto the old index
   * entry, so the rename is left out of the commit and stays staged. This is pinned as the documented
   * behaviour, not as desired behaviour. Detecting it was attempted
   * three ways by path shape and once by verifying the commit afterwards, and each attempt broke ordinary
   * operations instead: the first commit in a repository, an amend whose HEAD is a merge, and the everyday
   * amend that reverts part of the previous commit. The change is left visible in `git status` rather than
   * guarded by something that refuses correct commits.
   */
  it('leaves a case-only directory rename staged rather than refusing the commit', async () => {
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

    /*
     * The commit succeeds and the rename stays staged, which is what git does. The user can see it in
     * `git status`, and committing it needs a temporary name or the command line.
     */
    expect(result.ok).toBe(true)
    expect(await git(repository, ['diff', '--cached', '--name-only'])).toContain('helper.ts')
  })

  /** The same documented limitation when the file is renamed as well as the directory's case changed. */
  /**
   * A directory case change that also moves the file deeper. Verified against real git that this one commits
   * correctly through the whole path - the rename source is expanded in, git records the intended spelling, and
   * the tree is right - so the verification must not refuse it. Kept because the shape-based rules this
   * replaced were wrong about exactly this kind of case in both directions.
   */
  it('commits a directory case change that also changes the path depth', async () => {
    const { repository } = await createRepositoryWithWorktree()
    if (!(await filesystemConflatesCase(repository))) return
    await mkdir(path.join(repository, 'a', 'Deep'), { recursive: true })
    await writeFile(path.join(repository, 'a', 'Deep', 'f.ts'), 'export {}\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'add deep file'])

    await mkdir(path.join(repository, 'a', 'deep', 'more'), { recursive: true })
    await git(repository, ['mv', 'a/Deep/f.ts', 'a/deep/more/f.ts'])

    const result = await commitGit(repository, {
      message: 'move it deeper',
      amend: false,
      paths: ['a/deep/more/f.ts'],
    })

    expect(result.ok).toBe(true)
    const tracked = await git(repository, ['ls-tree', '-r', '--name-only', 'HEAD'])
    expect(tracked).toContain('a/deep/more/f.ts')
    expect((await git(repository, ['status', '--porcelain=v1'])).trim()).toBe('')
  })

  it('leaves a directory case change with a rename staged, committing the rest', async () => {
    const { repository } = await createRepositoryWithWorktree()
    if (!(await filesystemConflatesCase(repository))) return
    await mkdir(path.join(repository, 'components'), { recursive: true })
    await writeFile(path.join(repository, 'components', 'button.tsx'), 'export {}\n')
    await writeFile(path.join(repository, 'app.tsx'), 'import "./components/button"\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'add button'])

    await mkdir(path.join(repository, 'Components'), { recursive: true })
    await git(repository, ['mv', 'components/button.tsx', 'Components/PrimaryButton.tsx'])
    await writeFile(path.join(repository, 'app.tsx'), 'import "./Components/PrimaryButton"\n')

    const result = await commitGit(repository, {
      message: 'rename the button',
      amend: false,
      paths: ['Components/PrimaryButton.tsx', 'app.tsx'],
    })

    // The unrelated selected file is committed; the conflated rename stays staged and visible.
    expect(result.ok).toBe(true)
    expect(await git(repository, ['show', '--name-only', '--format=', 'HEAD'])).toContain('app.tsx')
    expect(await git(repository, ['diff', '--cached', '--name-only'])).toContain(
      'PrimaryButton.tsx',
    )
  })

  /**
   * The refusal must not reach a case-sensitive filesystem, where these are ordinary renames git performs
   * happily. The previous gate - "something still sits at the source path" - was not that question: a source is
   * occupied there for the ordinary reasons the occupancy check exists for.
   */
  it('commits an ordinary move whose components differ by more than case', async () => {
    const { repository } = await createRepositoryWithWorktree()
    await mkdir(path.join(repository, 'alpha'), { recursive: true })
    await writeFile(path.join(repository, 'alpha', 'file.ts'), 'export {}\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'add file'])

    await mkdir(path.join(repository, 'beta'), { recursive: true })
    await git(repository, ['mv', 'alpha/file.ts', 'beta/file.ts'])

    const result = await commitGit(repository, {
      message: 'move the file',
      amend: false,
      paths: ['beta/file.ts'],
    })

    expect(result.ok).toBe(true)
    const tracked = await git(repository, ['ls-tree', '-r', '--name-only', 'HEAD'])
    expect(tracked).toContain('beta/file.ts')
    expect(tracked).not.toContain('alpha/file.ts')
  })
})
