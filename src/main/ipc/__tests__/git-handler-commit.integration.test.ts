import { match } from '@diegogbrisa/ts-match'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  execFileMock,
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
} from './git-handler.test-harness'

const COMMIT_HASH = '0123456789abcdef0123456789abcdef01234567'

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
    const stagingCommands: string[] = []
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
        if (key === 'ls-files --unmerged') {
          cb(null, '', '')
          return
        }
        if (key === 'rev-parse --show-toplevel') {
          cb(null, '/tmp/repo\n', '')
          return
        }
        if (args.includes('status')) {
          cb(null, '', '')
          return
        }
        if (args.includes('update-index')) {
          stagingCommands.push(args.join(' '))
          cb(null, '', '')
          return
        }
        if (args.includes('commit')) {
          commitCommands.push(args.join(' '))
          cb(null, '[main abc1234] test commit\n 1 file changed\n', '')
          return
        }
        if (key === 'rev-parse HEAD') {
          cb(null, `${COMMIT_HASH}\n`, '')
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

    expect(result).toMatchObject({ ok: true, commitHash: COMMIT_HASH })
    expect(stagingCommands).toEqual(['--literal-pathspecs update-index --add --remove -z --stdin'])
    expect(commitCommands).toEqual([
      '--literal-pathspecs commit -m test commit --pathspec-from-file=- --pathspec-file-nul',
    ])
  })

  it('commits the existing index without staging unstaged changes when they are excluded', async () => {
    const mutationCommands: string[] = []
    execFileMock.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const key = args.join(' ')
        if (key === 'rev-parse --show-toplevel') return cb(null, '/tmp/repo\n', '')
        if (key === 'rev-parse --is-inside-work-tree') return cb(null, 'true\n', '')
        if (key === 'ls-files --unmerged') return cb(null, '', '')
        if (key === '--literal-pathspecs commit -m staged only') {
          mutationCommands.push(key)
          return cb(null, '[main abc1234] staged only\n', '')
        }
        if (key === 'rev-parse HEAD') return cb(null, `${COMMIT_HASH}\n`, '')
        if (args.includes('update-index')) mutationCommands.push(key)
        return cb(new Error(`Unexpected git command: ${key}`), '', '')
      },
    )

    registerGitHandlers()
    const result = await registeredHandler('git:commit')?.({}, '/tmp/repo', {
      message: 'staged only',
      amend: false,
      paths: ['src/staged.ts'],
      includeUnstaged: false,
    })

    expect(result).toMatchObject({ ok: true })
    expect(mutationCommands).toEqual(['--literal-pathspecs commit -m staged only'])
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
          .with('rev-parse --show-toplevel', () => cb(null, '/tmp/repo\n', ''))
          .when(
            (value) => value.includes('status'),
            () => cb(null, '', ''),
          )
          .with('ls-files --unmerged', () => cb(null, '', ''))
          .with('--literal-pathspecs update-index --add --remove -z --stdin', () =>
            cb(null, '', ''),
          )
          .with(
            '--literal-pathspecs commit -m test commit --pathspec-from-file=- --pathspec-file-nul',
            () =>
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

  it('does not stage when the unresolved-entry safety probe fails', async () => {
    const mutations: string[] = []
    execFileMock.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const key = args.join(' ')
        if (key === 'rev-parse --show-toplevel') return cb(null, '/tmp/repo\n', '')
        if (key === 'rev-parse --is-inside-work-tree') return cb(null, 'true\n', '')
        if (key === 'ls-files --unmerged') {
          return cb(new Error('spawn git EAGAIN'), '', 'spawn git EAGAIN')
        }
        if (args.includes('update-index') || args.includes('commit')) mutations.push(key)
        return cb(new Error(`Unexpected git command: ${key}`), '', '')
      },
    )

    registerGitHandlers()
    const result = await registeredHandler('git:commit')?.({}, '/tmp/repo', {
      message: 'unsafe commit',
      amend: false,
      paths: ['src/file.ts'],
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'unknown',
      message: expect.stringContaining('Could not inspect unresolved Git entries'),
    })
    expect(mutations).toEqual([])
  })

  it('does not stage when selected-rename discovery fails', async () => {
    const mutations: string[] = []
    execFileMock.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const key = args.join(' ')
        if (key === 'rev-parse --show-toplevel') return cb(null, '/tmp/repo\n', '')
        if (key === 'rev-parse --is-inside-work-tree') return cb(null, 'true\n', '')
        if (key === 'ls-files --unmerged') return cb(null, '', '')
        if (args.includes('status')) {
          return cb(new Error('spawn git EAGAIN'), '', 'spawn git EAGAIN')
        }
        if (args.includes('update-index') || args.includes('commit')) mutations.push(key)
        return cb(new Error(`Unexpected git command: ${key}`), '', '')
      },
    )

    registerGitHandlers()
    const result = await registeredHandler('git:commit')?.({}, '/tmp/repo', {
      message: 'rename-safe commit',
      amend: false,
      paths: ['src/renamed.ts'],
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'unknown',
      message: expect.stringContaining('Could not inspect selected Git paths'),
    })
    expect(mutations).toEqual([])
  })
})
