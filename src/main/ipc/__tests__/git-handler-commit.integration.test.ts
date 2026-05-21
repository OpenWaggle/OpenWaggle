import { match } from '@diegogbrisa/ts-match'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  execFileMock,
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
} from './git-handler.test-harness'

describe('registerGitHandlers commit', () => {
  let registerGitHandlers: Awaited<ReturnType<typeof loadGitHandlers>>['registerGitHandlers']
  let invalidateGitStatusCache: Awaited<
    ReturnType<typeof loadGitHandlers>
  >['invalidateGitStatusCache']

  beforeEach(async () => {
    resetGitHandlerMocks()
    ;({ invalidateGitStatusCache, registerGitHandlers } = await loadGitHandlers())
    invalidateGitStatusCache()
  })

  it('stages only specified paths when committing', async () => {
    const stagedPaths: string[][] = []
    const commitCommands: string[] = []

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
          stagedPaths.push(args.slice(2))
          cb(null, '', '')
          return
        }
        if (args[0] === 'commit') {
          commitCommands.push(args.join(' '))
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

    const result = await handler?.({}, '/tmp/repo', {
      message: 'test commit',
      amend: false,
      paths: ['src/main/index.ts', 'docs/new.md'],
    })

    expect(result).toMatchObject({ ok: true, commitHash: 'abc1234' })
    expect(stagedPaths).toEqual([['src/main/index.ts', 'docs/new.md']])
    expect(commitCommands).toEqual(['commit -m test commit -- src/main/index.ts docs/new.md'])
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
        match(key)
          .with('rev-parse --is-inside-work-tree', () => cb(null, 'true\n', ''))
          .with('rev-parse -q --verify MERGE_HEAD', () =>
            cb(
              { name: 'GitError', message: 'not merging', code: 1, stdout: '', stderr: '' },
              '',
              '',
            ),
          )
          .with('add -- src/file.ts', () => cb(null, '', ''))
          .with('commit -m test commit -- src/file.ts', () =>
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
            ),
          )
          .otherwise(() => cb(new Error(`Unexpected git command: ${key}`), '', ''))
      },
    )

    registerGitHandlers()
    const handler = registeredHandler('git:commit')
    expect(handler).toBeDefined()

    const result = await handler?.({}, '/tmp/repo', {
      message: 'test commit',
      amend: false,
      paths: ['src/file.ts'],
    })

    expect(result).toEqual({
      ok: false,
      code: 'nothing-to-commit',
      message: 'No changes available to commit.',
    })
  })
})
