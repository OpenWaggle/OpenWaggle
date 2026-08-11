import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  materializeHostedSessionWorktree,
  removeHostedSessionWorktree,
} from '../openwaggle-mcp-session-worktree'

let temporaryRoot = ''
let repositoryPath = ''
let storageRoot = ''

function git(args: readonly string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile('git', [...args], { cwd: repositoryPath, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

beforeEach(async () => {
  temporaryRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-worktree-')))
  repositoryPath = path.join(temporaryRoot, 'repository')
  storageRoot = path.join(temporaryRoot, 'hosted-worktrees')
  await mkdir(repositoryPath)
  await git(['init', '-b', 'main'])
  await git(['config', 'user.email', 'test@openwaggle.invalid'])
  await git(['config', 'user.name', 'OpenWaggle Test'])
  await writeFile(path.join(repositoryPath, 'README.md'), 'hosted worktree test\n')
  await git(['add', '--', 'README.md'])
  await git(['commit', '-m', 'initial'])
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('hosted MCP session Git worktrees', () => {
  it('materializes idempotently and removes only the worktree it created', async () => {
    const input = {
      sourceProjectPath: repositoryPath,
      sourceSessionId: 'session-source',
      baseRef: 'main',
      startFromOrigin: false,
    } as const

    const created = await materializeHostedSessionWorktree(input, storageRoot)
    const reused = await materializeHostedSessionWorktree(input, storageRoot)

    expect(created).toMatchObject({ created: true, baseRef: 'main' })
    expect(reused).toEqual({ ...created, created: false })
    expect(created.projectPath.startsWith(`${storageRoot}${path.sep}`)).toBe(true)

    await removeHostedSessionWorktree(created)
    await expect(lstat(created.projectPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(git(['show-ref', '--verify', `refs/heads/${created.branch}`])).rejects.toThrow()
  })

  it('recovers a deterministic branch left at the verified base commit', async () => {
    const input = {
      sourceProjectPath: repositoryPath,
      sourceSessionId: 'session-residual',
      baseRef: 'main',
      startFromOrigin: false,
    } as const
    const initial = await materializeHostedSessionWorktree(input, storageRoot)
    await removeHostedSessionWorktree(initial)
    await git(['branch', initial.branch, 'main'])

    const recovered = await materializeHostedSessionWorktree(input, storageRoot)

    expect(recovered).toMatchObject({ branch: initial.branch, baseRef: 'main', created: true })
    await removeHostedSessionWorktree(recovered)
  })

  it('preserves and rejects a deterministic branch that points at another commit', async () => {
    const baseCommit = (await git(['rev-parse', 'HEAD'])).trim()
    const input = {
      sourceProjectPath: repositoryPath,
      sourceSessionId: 'session-conflicting-residual',
      baseRef: baseCommit,
      startFromOrigin: false,
    } as const
    const initial = await materializeHostedSessionWorktree(input, storageRoot)
    await removeHostedSessionWorktree(initial)
    await writeFile(path.join(repositoryPath, 'second.txt'), 'second commit\n')
    await git(['add', '--', 'second.txt'])
    await git(['commit', '-m', 'second'])
    await git(['branch', initial.branch, 'HEAD'])

    await expect(materializeHostedSessionWorktree(input, storageRoot)).rejects.toThrow(
      'points at a different commit',
    )
    await expect(git(['show-ref', '--verify', `refs/heads/${initial.branch}`])).resolves.toContain(
      `refs/heads/${initial.branch}`,
    )
  })

  it('rejects a pre-existing symbolic-link destination', async () => {
    const input = {
      sourceProjectPath: repositoryPath,
      sourceSessionId: 'session-symlink',
      baseRef: 'main',
      startFromOrigin: false,
    } as const
    const created = await materializeHostedSessionWorktree(input, storageRoot)
    await removeHostedSessionWorktree(created)
    await symlink(repositoryPath, created.projectPath, 'dir')

    await expect(materializeHostedSessionWorktree(input, storageRoot)).rejects.toThrow(
      'symbolic-link worktree destination',
    )
  })

  it('rejects symbolic links in destination parent components', async () => {
    const actualStorage = path.join(temporaryRoot, 'actual-storage')
    const linkedStorage = path.join(temporaryRoot, 'linked-storage')
    await mkdir(actualStorage)
    await symlink(actualStorage, linkedStorage, 'dir')

    await expect(
      materializeHostedSessionWorktree(
        {
          sourceProjectPath: repositoryPath,
          sourceSessionId: 'session-linked-parent',
          baseRef: 'main',
          startFromOrigin: false,
        },
        path.join(linkedStorage, 'worktrees'),
      ),
    ).rejects.toThrow('not a real directory')
  })

  it('rejects option-like base refs before invoking Git revision selection', async () => {
    await expect(
      materializeHostedSessionWorktree(
        {
          sourceProjectPath: repositoryPath,
          sourceSessionId: 'session-invalid-ref',
          baseRef: '--upload-pack=malicious',
          startFromOrigin: false,
        },
        storageRoot,
      ),
    ).rejects.toThrow('option prefix')
  })
})
