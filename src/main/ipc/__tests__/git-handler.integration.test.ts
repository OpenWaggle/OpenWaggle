import { match } from '@diegogbrisa/ts-match'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  execFileMock,
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
} from './git-handler.test-harness'

describe('registerGitHandlers status', () => {
  let registerGitHandlers: Awaited<ReturnType<typeof loadGitHandlers>>['registerGitHandlers']
  let invalidateGitStatusCache: Awaited<
    ReturnType<typeof loadGitHandlers>
  >['invalidateGitStatusCache']

  beforeEach(async () => {
    resetGitHandlerMocks()
    ;({ invalidateGitStatusCache, registerGitHandlers } = await loadGitHandlers())
    invalidateGitStatusCache()
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
        match(key)
          .with('rev-parse --is-inside-work-tree', () => cb(null, 'true\n', ''))
          .with('rev-parse --abbrev-ref HEAD', () => cb(null, 'main\n', ''))
          .with('status --porcelain=v1', () =>
            cb(null, ' M src/main/index.ts\n?? docs/new.md\n', ''),
          )
          .with('diff --numstat HEAD', () => cb(null, '10\t2\tsrc/main/index.ts\n', ''))
          .with('rev-list --left-right --count HEAD...@{upstream}', () => cb(null, '3\t1\n', ''))
          .otherwise(() => cb(new Error(`Unexpected git command: ${key}`), '', ''))
      },
    )

    registerGitHandlers()
    const handler = registeredHandler('git:status')
    expect(handler).toBeDefined()

    const result = await handler?.({}, '/tmp/repo')

    expect(result).toMatchObject({
      branch: 'main',
      additions: 10,
      deletions: 2,
      filesChanged: 2,
      ahead: 3,
      behind: 1,
    })
  })

  it('normalizes renamed paths from porcelain and numstat into a single changed file', async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const key = args.join(' ')
        match(key)
          .with('rev-parse --is-inside-work-tree', () => cb(null, 'true\n', ''))
          .with('rev-parse --abbrev-ref HEAD', () => cb(null, 'main\n', ''))
          .with('status --porcelain=v1', () => cb(null, 'RM old.txt -> new.txt\n', ''))
          .with('diff --numstat HEAD', () => cb(null, '1\t0\told.txt => new.txt\n', ''))
          .with('rev-list --left-right --count HEAD...@{upstream}', () => cb(null, '0\t0\n', ''))
          .otherwise(() => cb(new Error(`Unexpected git command: ${key}`), '', ''))
      },
    )

    registerGitHandlers()
    const handler = registeredHandler('git:status')
    expect(handler).toBeDefined()

    const result = await handler?.({}, '/tmp/repo')

    expect(result).toMatchObject({
      filesChanged: 1,
      additions: 1,
      deletions: 0,
      changedFiles: [
        {
          path: 'new.txt',
          additions: 1,
          deletions: 0,
          status: 'modified',
          staged: true,
        },
      ],
    })
  })
})
