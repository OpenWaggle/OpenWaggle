import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveRepositoryRoot } from '../working-tree-service'

const execFileAsync = promisify(execFile)
let repositoryPath: string | null = null

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd })
  return stdout
}

/** A repository whose interesting content lives in a subdirectory, as in a monorepo. */
async function createRepositoryWithPackage() {
  const root = await mkdtemp(path.join(tmpdir(), 'openwaggle-commit-subdir-'))
  repositoryPath = root
  await git(root, ['init', '--initial-branch=main'])
  await git(root, ['config', 'user.name', 'OpenWaggle Test'])
  await git(root, ['config', 'user.email', 'openwaggle@example.test'])
  const openedDirectory = path.join(root, 'packages', 'app')
  await mkdir(openedDirectory, { recursive: true })
  await writeFile(path.join(openedDirectory, 'x.txt'), 'seed\n')
  await git(root, ['add', '--all'])
  await git(root, ['commit', '-m', 'chore: baseline'])
  await writeFile(path.join(openedDirectory, 'x.txt'), 'changed\n')
  return { root, openedDirectory }
}

afterEach(async () => {
  if (repositoryPath) await rm(repositoryPath, { recursive: true, force: true })
  repositoryPath = null
})

describe('commit paths in a subdirectory-opened repository', () => {
  it('resolves the repository root, where repository-relative pathspecs match', async () => {
    /*
     * The paths come from `git status --porcelain`, which reports them relative to the repository
     * root, and the renderer passes them straight through. Staging them in the *opened* directory
     * resolved them relative to that instead, so a repository opened at `packages/app` produced
     * "pathspec 'packages/app/x.txt' did not match any files" and every commit-bearing action was
     * dead. `git add --all` had hidden it because it takes no pathspec.
     */
    const { root, openedDirectory } = await createRepositoryWithPackage()
    const changed = (await git(openedDirectory, ['status', '--porcelain=v1'])).trim()
    // What the renderer would hand the commit phase.
    expect(changed).toContain('packages/app/x.txt')

    // macOS reports /private/var for /var, so compare the resolved forms.
    const resolvedRoot = await resolveRepositoryRoot(openedDirectory)
    expect(resolvedRoot).not.toBeNull()
    expect(await realpath(resolvedRoot ?? '')).toBe(await realpath(root))

    // Staging at the resolved root matches, and commits the file the user changed.
    await git(root, ['add', '--', 'packages/app/x.txt'])
    await git(root, ['commit', '-m', 'fix: commit from a subdirectory'])
    const log = await git(root, ['log', '--oneline', '-1', '--name-only'])
    expect(log).toContain('packages/app/x.txt')
  })

  it('fails the way the user saw it when the same pathspec runs in the opened directory', async () => {
    // Pins the diagnosis, so the reason for resolving the root cannot be forgotten.
    const { openedDirectory } = await createRepositoryWithPackage()

    await expect(
      execFileAsync('git', ['add', '--', 'packages/app/x.txt'], { cwd: openedDirectory }),
    ).rejects.toThrow(/did not match any files/u)
  })
})

describe('committing a rename', () => {
  it('covers both paths, so the rename is not committed as a duplicate', async () => {
    /*
     * `git status` reports a rename under its target only, and a pathspec commit covers exactly the
     * paths it is given: committing with just the target produced a commit containing *both* files
     * and left the staged deletion of the source behind. Verified against real git.
     */
    const { root } = await createRepositoryWithPackage()
    await git(root, ['mv', 'packages/app/x.txt', 'packages/app/y.txt'])

    const porcelain = (await git(root, ['status', '--porcelain=v1'])).trim()
    expect(porcelain).toContain('->')

    // Both paths, which is what the renderer now derives from `renamedFrom`.
    await git(root, [
      'commit',
      '-m',
      'refactor: rename',
      '--',
      'packages/app/x.txt',
      'packages/app/y.txt',
    ])

    expect((await git(root, ['status', '--porcelain=v1'])).trim()).toBe('')
    const tracked = await git(root, ['ls-tree', '-r', '--name-only', 'HEAD'])
    expect(tracked).toContain('packages/app/y.txt')
    expect(tracked).not.toContain('packages/app/x.txt')
  })
})
