/** Real-git fixtures for the commit tests: a repository with a linked worktree, and small git helpers. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, vi } from 'vitest'

/*
 * commit-handler reaches Electron transitively through the status cache. Only the
 * committing behaviour is under test here, so the app surfaces it touches are stubbed.
 */
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getName: () => 'openwaggle-test' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

const { execFileAsync } = await import('../shared')

let repositoryPath: string | null = null

export async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd })
  return typeof result === 'string' ? result : (result.stdout ?? '')
}

export async function headSubject(cwd: string): Promise<string> {
  return (await git(cwd, ['log', '-1', '--pretty=%s'])).trim()
}

export async function createRepositoryWithWorktree(): Promise<{
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

/**
 * Whether this filesystem treats two spellings of one name as the same file.
 *
 * Asked rather than assumed from the platform: developers here work on case-insensitive macOS while CI runs on
 * case-sensitive Linux, and a case-only rename is perfectly committable on the latter.
 */
export async function filesystemConflatesCase(directory: string) {
  const probe = path.join(directory, 'CaseProbe.tmp')
  await writeFile(probe, 'probe\n')
  try {
    await readFile(path.join(directory, 'caseprobe.tmp'), 'utf8')
    return true
  } catch {
    return false
  } finally {
    await rm(probe, { force: true })
  }
}
