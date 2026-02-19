import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileMock, handleMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  handleMock: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}))

import { registerGitHandlers } from './git-handler'

function registeredHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = handleMock.mock.calls.find(([channel]) => channel === name)
  return call?.[1] as ((...args: unknown[]) => Promise<unknown>) | undefined
}

describe('registerGitHandlers', () => {
  beforeEach(() => {
    handleMock.mockReset()
    execFileMock.mockReset()
  })

  it('returns parsed git status summary with correct ahead/behind', async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const key = args.join(' ')
        switch (key) {
          case 'rev-parse --is-inside-work-tree':
            cb(null, 'true\n', '')
            return
          case 'rev-parse --abbrev-ref HEAD':
            cb(null, 'main\n', '')
            return
          case 'status --porcelain=v1':
            cb(null, ' M src/main/index.ts\n?? docs/new.md\n', '')
            return
          case 'diff --numstat HEAD':
            cb(null, '10\t2\tsrc/main/index.ts\n', '')
            return
          case 'rev-list --left-right --count HEAD...@{upstream}':
            // Output format: <ahead>\t<behind>
            cb(null, '3\t1\n', '')
            return
          default:
            cb(new Error(`Unexpected git command: ${key}`), '', '')
        }
      },
    )

    registerGitHandlers()
    const handler = registeredHandler('git:status')
    expect(handler).toBeDefined()

    const result = (await handler?.({}, '/tmp/repo')) as {
      branch: string
      additions: number
      deletions: number
      filesChanged: number
      ahead: number
      behind: number
    }

    expect(result).toMatchObject({
      branch: 'main',
      additions: 10,
      deletions: 2,
      filesChanged: 2,
      ahead: 3,
      behind: 1,
    })
  })

  it('stages only specified paths when committing', async () => {
    const stagedPaths: string[][] = []

    execFileMock.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (
          err: (Error & { code?: number; stdout?: string; stderr?: string }) | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        const key = args.join(' ')

        if (key === 'rev-parse --is-inside-work-tree') {
          cb(null, 'true\n', '')
          return
        }
        if (key === 'rev-parse -q --verify MERGE_HEAD') {
          cb({ name: 'GitError', message: 'not merging', code: 1, stdout: '', stderr: '' }, '', '')
          return
        }
        if (args[0] === 'add') {
          stagedPaths.push(args.slice(2)) // skip 'add' and '--'
          cb(null, '', '')
          return
        }
        if (args[0] === 'commit') {
          cb(null, '[main abc1234] test commit\n 1 file changed\n', '')
          return
        }
        if (key === 'rev-parse HEAD') {
          cb(null, 'abc1234\n', '')
          return
        }
        cb(new Error(`Unexpected git command: ${key}`), '', '')
      },
    )

    registerGitHandlers()
    const handler = registeredHandler('git:commit')
    expect(handler).toBeDefined()

    const result = (await handler?.({}, '/tmp/repo', {
      message: 'test commit',
      amend: false,
      paths: ['src/main/index.ts', 'docs/new.md'],
    })) as { ok: boolean; commitHash?: string }

    expect(result.ok).toBe(true)
    expect(result.commitHash).toBe('abc1234')
    expect(stagedPaths).toEqual([['src/main/index.ts', 'docs/new.md']])
  })

  it('maps commit failures to structured error codes', async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (
          err: (Error & { code?: number; stdout?: string; stderr?: string }) | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        const key = args.join(' ')
        switch (key) {
          case 'rev-parse --is-inside-work-tree':
            cb(null, 'true\n', '')
            return
          case 'rev-parse -q --verify MERGE_HEAD':
            cb(
              { name: 'GitError', message: 'not merging', code: 1, stdout: '', stderr: '' },
              '',
              '',
            )
            return
          case 'add -- src/file.ts':
            cb(null, '', '')
            return
          case 'commit -m test commit':
            cb(
              {
                name: 'GitError',
                message: 'failed',
                code: 1,
                stdout: '',
                stderr: 'nothing to commit, working tree clean',
              },
              '',
              '',
            )
            return
          default:
            cb(new Error(`Unexpected git command: ${key}`), '', '')
        }
      },
    )

    registerGitHandlers()
    const handler = registeredHandler('git:commit')
    expect(handler).toBeDefined()

    const result = (await handler?.({}, '/tmp/repo', {
      message: 'test commit',
      amend: false,
      paths: ['src/file.ts'],
    })) as { ok: boolean; code?: string }

    expect(result).toEqual({
      ok: false,
      code: 'nothing-to-commit',
      message: 'No changes available to commit.',
    })
  })

  it('lists local and remote branches with upstream metadata', async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const key = args.join(' ')
        switch (key) {
          case 'rev-parse --is-inside-work-tree':
            cb(null, 'true\n', '')
            return
          case 'rev-parse --abbrev-ref HEAD':
            cb(null, 'main\n', '')
            return
          case 'for-each-ref --format=%(refname)%09%(refname:short)%09%(upstream:short)%09%(HEAD)%09%(upstream:track) refs/heads refs/remotes':
            cb(
              null,
              [
                'refs/heads/main\tmain\torigin/main\t*\t[ahead 2, behind 1]',
                'refs/heads/feature\tfeature\torigin/feature\t\t',
                'refs/remotes/origin/main\torigin/main\t\t\t',
                'refs/remotes/origin/HEAD\torigin/HEAD\t\t\t',
              ].join('\n'),
              '',
            )
            return
          default:
            cb(new Error(`Unexpected git command: ${key}`), '', '')
        }
      },
    )

    registerGitHandlers()
    const handler = registeredHandler('git:branches:list')
    expect(handler).toBeDefined()

    const result = (await handler?.({}, '/tmp/repo')) as {
      currentBranch: string | null
      branches: Array<{
        name: string
        isRemote: boolean
        isCurrent: boolean
        ahead: number
        behind: number
      }>
    }

    expect(result.currentBranch).toBe('main')
    expect(result.branches.map((branch) => branch.name)).toEqual(['feature', 'main', 'origin/main'])
    expect(result.branches.find((branch) => branch.name === 'main')).toMatchObject({
      isRemote: false,
      isCurrent: true,
      ahead: 2,
      behind: 1,
    })
  })

  it('checks out remote branches as local tracking branches', async () => {
    const gitCommands: string[] = []

    execFileMock.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (
          err: (Error & { code?: number; stdout?: string; stderr?: string }) | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        const key = args.join(' ')
        gitCommands.push(key)

        if (key === 'rev-parse --is-inside-work-tree') {
          cb(null, 'true\n', '')
          return
        }
        if (key === 'show-ref --verify --quiet refs/remotes/origin/feature') {
          cb(null, '', '')
          return
        }
        if (key === 'show-ref --verify --quiet refs/heads/feature') {
          cb({ name: 'GitError', message: 'missing', code: 1, stdout: '', stderr: '' }, '', '')
          return
        }
        if (key === 'checkout --track origin/feature') {
          cb(null, "branch 'feature' set up to track 'origin/feature'\n", '')
          return
        }
        cb(new Error(`Unexpected git command: ${key}`), '', '')
      },
    )

    registerGitHandlers()
    const handler = registeredHandler('git:branches:checkout')
    expect(handler).toBeDefined()

    const result = (await handler?.({}, '/tmp/repo', {
      name: 'origin/feature',
    })) as { ok: boolean; message: string }

    expect(result).toEqual({
      ok: true,
      message: 'Switched to tracking branch origin/feature.',
    })
    expect(gitCommands).toEqual([
      'rev-parse --is-inside-work-tree',
      'show-ref --verify --quiet refs/remotes/origin/feature',
      'show-ref --verify --quiet refs/heads/feature',
      'checkout --track origin/feature',
    ])
  })

  it('maps upstream branch failures to typed branch errors', async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (
          err: (Error & { code?: number; stdout?: string; stderr?: string }) | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        const key = args.join(' ')
        if (key === 'rev-parse --is-inside-work-tree') {
          cb(null, 'true\n', '')
          return
        }
        if (key === 'branch --set-upstream-to origin/missing main') {
          cb(
            {
              name: 'GitError',
              message: 'failed',
              code: 1,
              stdout: '',
              stderr: "fatal: upstream branch 'origin/missing' does not exist",
            },
            '',
            '',
          )
          return
        }
        cb(new Error(`Unexpected git command: ${key}`), '', '')
      },
    )

    registerGitHandlers()
    const handler = registeredHandler('git:branches:set-upstream')
    expect(handler).toBeDefined()

    const result = (await handler?.({}, '/tmp/repo', {
      name: 'main',
      upstream: 'origin/missing',
    })) as { ok: boolean; code?: string; message: string }

    expect(result).toEqual({
      ok: false,
      code: 'upstream-not-found',
      message: 'The selected upstream branch does not exist.',
    })
  })
})
