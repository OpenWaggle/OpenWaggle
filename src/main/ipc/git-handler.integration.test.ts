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
})
