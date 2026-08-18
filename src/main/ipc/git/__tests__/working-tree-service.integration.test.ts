import { access, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { execFileAsync } from '../shared'
import { revertAllGitChanges, stageAllGitChanges } from '../working-tree-service'

let projectPath: string | null = null

async function runGit(args: readonly string[]): Promise<string> {
  if (!projectPath) throw new Error('Temporary Git repository is not initialized.')
  const result = await execFileAsync('git', args, { cwd: projectPath })
  return typeof result === 'string' ? result : (result.stdout ?? '')
}

async function createRepository(): Promise<string> {
  projectPath = await mkdtemp(path.join(tmpdir(), 'openwaggle-git-actions-'))
  await runGit(['init'])
  await runGit(['config', 'user.name', 'OpenWaggle Test'])
  await runGit(['config', 'user.email', 'openwaggle@example.test'])
  await writeFile(path.join(projectPath, 'modified.txt'), 'before\n')
  await writeFile(path.join(projectPath, 'deleted.txt'), 'delete me\n')
  await writeFile(path.join(projectPath, '.gitignore'), 'ignored.log\n')
  await runGit(['add', '--all'])
  await runGit(['commit', '-m', 'Initial commit'])
  return projectPath
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  if (projectPath) await rm(projectPath, { recursive: true, force: true })
  projectPath = null
})

describe('Git working-tree actions', () => {
  it('stages modified, deleted, and untracked paths across the repository', async () => {
    const repositoryPath = await createRepository()
    await writeFile(path.join(repositoryPath, 'modified.txt'), 'after\n')
    await unlink(path.join(repositoryPath, 'deleted.txt'))
    await mkdir(path.join(repositoryPath, 'new-directory'))
    await writeFile(path.join(repositoryPath, 'new-directory', 'untracked.txt'), 'new\n')

    const result = await stageAllGitChanges(repositoryPath)

    expect(result).toEqual({ ok: true, message: 'All working-tree changes staged.' })
    expect(await runGit(['diff', '--name-only'])).toBe('')
    expect(await runGit(['diff', '--cached', '--name-status'])).toBe(
      'D\tdeleted.txt\nM\tmodified.txt\nA\tnew-directory/untracked.txt\n',
    )
  })

  it('reverts tracked and staged changes while safely retaining ignored files and nested repos', async () => {
    const repositoryPath = await createRepository()
    const stagedPath = path.join(repositoryPath, 'staged-new.txt')
    const untrackedPath = path.join(repositoryPath, 'untracked.txt')
    const ignoredPath = path.join(repositoryPath, 'ignored.log')
    const nestedRepositoryPath = path.join(repositoryPath, 'nested-repository')

    await writeFile(path.join(repositoryPath, 'modified.txt'), 'after\n')
    await unlink(path.join(repositoryPath, 'deleted.txt'))
    await writeFile(stagedPath, 'staged\n')
    await runGit(['add', 'staged-new.txt'])
    await writeFile(untrackedPath, 'untracked\n')
    await writeFile(ignoredPath, 'ignored\n')
    await mkdir(nestedRepositoryPath)
    await execFileAsync('git', ['init'], { cwd: nestedRepositoryPath })
    await writeFile(path.join(nestedRepositoryPath, 'kept.txt'), 'nested\n')

    const result = await revertAllGitChanges(repositoryPath)

    expect(result).toEqual({ ok: true, message: 'All eligible working-tree changes reverted.' })
    expect(await readFile(path.join(repositoryPath, 'modified.txt'), 'utf8')).toBe('before\n')
    expect(await readFile(path.join(repositoryPath, 'deleted.txt'), 'utf8')).toBe('delete me\n')
    expect(await pathExists(stagedPath)).toBe(false)
    expect(await pathExists(untrackedPath)).toBe(false)
    expect(await readFile(ignoredPath, 'utf8')).toBe('ignored\n')
    expect(await readFile(path.join(nestedRepositoryPath, 'kept.txt'), 'utf8')).toBe('nested\n')
  })

  it('stages and reverts the entire repository when the selected project is a subdirectory', async () => {
    const repositoryPath = await createRepository()
    const projectSubdirectory = path.join(repositoryPath, 'project')
    const rootUntrackedPath = path.join(repositoryPath, 'root-untracked.txt')

    await mkdir(projectSubdirectory)
    await writeFile(rootUntrackedPath, 'untracked\n')

    const stageResult = await stageAllGitChanges(projectSubdirectory)

    expect(stageResult).toEqual({ ok: true, message: 'All working-tree changes staged.' })
    expect(await runGit(['diff', '--cached', '--name-status'])).toBe('A\troot-untracked.txt\n')

    const result = await revertAllGitChanges(projectSubdirectory)

    expect(result).toEqual({ ok: true, message: 'All eligible working-tree changes reverted.' })
    expect(await pathExists(rootUntrackedPath)).toBe(false)
  })

  it('refuses to overwrite a preserved path that obstructs tracked restoration', async () => {
    const repositoryPath = await createRepository()
    const protectedDirectory = path.join(repositoryPath, 'protected')
    const protectedFile = path.join(protectedDirectory, 'tracked.txt')

    await mkdir(protectedDirectory)
    await writeFile(protectedFile, 'tracked\n')
    await runGit(['add', 'protected/tracked.txt'])
    await runGit(['commit', '-m', 'Add protected path'])
    await writeFile(path.join(repositoryPath, '.git', 'info', 'exclude'), 'protected\n')
    await rm(protectedDirectory, { recursive: true })
    await writeFile(protectedDirectory, 'ignored obstruction\n')

    const result = await revertAllGitChanges(repositoryPath)

    expect(result).toEqual({
      ok: false,
      code: 'unsafe-revert',
      message: 'Revert all stopped because protected obstructs a tracked path.',
    })
    expect(await readFile(protectedDirectory, 'utf8')).toBe('ignored obstruction\n')
  })

  it('refuses to modify outer tracked paths inside a nested repository', async () => {
    const repositoryPath = await createRepository()
    const nestedRepositoryPath = path.join(repositoryPath, 'nested-overlap')
    const overlappingPath = path.join(nestedRepositoryPath, 'outer-tracked.txt')

    await mkdir(nestedRepositoryPath)
    await writeFile(overlappingPath, 'outer version\n')
    await runGit(['add', 'nested-overlap/outer-tracked.txt'])
    await runGit(['commit', '-m', 'Track nested overlap'])
    await execFileAsync('git', ['init'], { cwd: nestedRepositoryPath })
    await execFileAsync('git', ['config', 'user.name', 'Nested Test'], {
      cwd: nestedRepositoryPath,
    })
    await execFileAsync('git', ['config', 'user.email', 'nested@example.test'], {
      cwd: nestedRepositoryPath,
    })
    await execFileAsync('git', ['add', 'outer-tracked.txt'], { cwd: nestedRepositoryPath })
    await execFileAsync('git', ['commit', '-m', 'Nested baseline'], { cwd: nestedRepositoryPath })
    await writeFile(overlappingPath, 'nested version\n')
    await execFileAsync('git', ['commit', '-am', 'Nested update'], { cwd: nestedRepositoryPath })

    const result = await revertAllGitChanges(repositoryPath)

    expect(result).toEqual({
      ok: false,
      code: 'unsafe-revert',
      message: 'Revert all stopped because nested-overlap obstructs a tracked path.',
    })
    expect(await readFile(overlappingPath, 'utf8')).toBe('nested version\n')
  })

  it('refuses when a type-changed directory holds ignored content reset --hard would destroy', async () => {
    const repositoryPath = await createRepository()
    // `modified.txt` is a tracked file in HEAD; turn it into a directory (a type change)
    // that also holds a staged descendant and an ignored file. `reset --hard` would have
    // to remove the directory to restore the file, taking the ignored file with it.
    const typeChangedPath = path.join(repositoryPath, 'modified.txt')
    const ignoredInside = path.join(typeChangedPath, 'ignored.log')

    await unlink(typeChangedPath)
    await mkdir(typeChangedPath)
    await writeFile(path.join(typeChangedPath, 'staged.txt'), 'staged\n')
    await runGit(['add', 'modified.txt/staged.txt'])
    await writeFile(ignoredInside, 'precious ignored data\n')

    const result = await revertAllGitChanges(repositoryPath)

    expect(result).toEqual({
      ok: false,
      code: 'unsafe-revert',
      message: 'Revert all stopped because modified.txt obstructs a tracked path.',
    })
    expect(await readFile(ignoredInside, 'utf8')).toBe('precious ignored data\n')
  })

  it('reverts unrelated changes without flagging an initialized tracked submodule', async () => {
    const repositoryPath = await createRepository()
    const submoduleSource = await mkdtemp(path.join(tmpdir(), 'openwaggle-submodule-src-'))
    try {
      await execFileAsync('git', ['init'], { cwd: submoduleSource })
      await execFileAsync('git', ['config', 'user.name', 'Sub Test'], { cwd: submoduleSource })
      await execFileAsync('git', ['config', 'user.email', 'sub@example.test'], {
        cwd: submoduleSource,
      })
      await writeFile(path.join(submoduleSource, 'lib.txt'), 'lib\n')
      await execFileAsync('git', ['add', '--all'], { cwd: submoduleSource })
      await execFileAsync('git', ['commit', '-m', 'Submodule baseline'], { cwd: submoduleSource })

      await runGit(['-c', 'protocol.file.allow=always', 'submodule', 'add', submoduleSource, 'sub'])
      await runGit(['commit', '-m', 'Add submodule'])
      // An unrelated tracked change that revert-all must still handle.
      await writeFile(path.join(repositoryPath, 'modified.txt'), 'after\n')

      const result = await revertAllGitChanges(repositoryPath)

      expect(result).toEqual({ ok: true, message: 'All eligible working-tree changes reverted.' })
      expect(await readFile(path.join(repositoryPath, 'modified.txt'), 'utf8')).toBe('before\n')
      expect(await pathExists(path.join(repositoryPath, 'sub', '.git'))).toBe(true)
    } finally {
      await rm(submoduleSource, { recursive: true, force: true })
    }
  })
})
