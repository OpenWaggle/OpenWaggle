import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getName: () => 'openwaggle-test' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

const { commitGit } = await import('../commit-handler')
const { getGitStatus } = await import('../status-service')

const execFileAsync = promisify(execFile)
const CONTROL_CHARACTER_PATHS = ['line\nbreak.txt', 'tab\tname.txt', 'back\\slash.txt'] as const
let repositoryPath: string | null = null

async function git(cwd: string, args: readonly string[]) {
  const { stdout } = await execFileAsync('git', [...args], { cwd })
  return stdout
}

afterEach(async () => {
  if (repositoryPath) await rm(repositoryPath, { recursive: true, force: true })
  repositoryPath = null
})

describe('Git paths containing control characters', () => {
  it('reports, stages, and commits each filename without changing its bytes', async () => {
    const repository = await mkdtemp(path.join(tmpdir(), 'openwaggle-control-paths-'))
    repositoryPath = repository
    await git(repository, ['init', '--initial-branch=main'])
    await git(repository, ['config', 'user.name', 'OpenWaggle Test'])
    await git(repository, ['config', 'user.email', 'openwaggle@example.test'])
    await git(repository, ['config', 'commit.gpgsign', 'false'])

    const [newlinePath, tabPath, backslashPath] = CONTROL_CHARACTER_PATHS
    await writeFile(path.join(repository, newlinePath), 'before\n')
    await git(repository, ['add', '--all'])
    await git(repository, ['commit', '-m', 'chore: baseline'])
    await writeFile(path.join(repository, newlinePath), 'after\n')
    await writeFile(path.join(repository, tabPath), 'staged\n')
    await git(repository, ['add', '--', tabPath])
    await writeFile(path.join(repository, backslashPath), 'untracked\n')

    const beforeCommit = await getGitStatus(repository)
    expect(new Set(beforeCommit.changedFiles.map((file) => file.path))).toEqual(
      new Set(CONTROL_CHARACTER_PATHS),
    )
    const changesByPath = new Map(beforeCommit.changedFiles.map((file) => [file.path, file]))
    expect(changesByPath.get(newlinePath)).toMatchObject({ status: 'modified', unstaged: true })
    expect(changesByPath.get(tabPath)).toMatchObject({ status: 'added', staged: true })
    expect(changesByPath.get(backslashPath)).toMatchObject({
      status: 'untracked',
      unstaged: true,
    })

    const result = await commitGit(repository, {
      message: 'fix: preserve control-character paths',
      amend: false,
      paths: beforeCommit.changedFiles.map((file) => file.path),
    })

    expect(result.ok).toBe(true)
    const committedPaths = (
      await git(repository, ['show', '--format=', '--name-only', '-z', 'HEAD'])
    )
      .split('\0')
      .filter(Boolean)
    expect(new Set(committedPaths)).toEqual(new Set(CONTROL_CHARACTER_PATHS))
    expect((await getGitStatus(repository)).clean).toBe(true)
  })
})
