import { match } from '@diegogbrisa/ts-match'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  execFileMock,
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
} from './git-handler.test-harness'

describe('registerGitHandlers branches', () => {
  let registerGitHandlers: Awaited<ReturnType<typeof loadGitHandlers>>['registerGitHandlers']
  let invalidateGitStatusCache: Awaited<
    ReturnType<typeof loadGitHandlers>
  >['invalidateGitStatusCache']

  beforeEach(async () => {
    resetGitHandlerMocks()
    ;({ invalidateGitStatusCache, registerGitHandlers } = await loadGitHandlers())
    invalidateGitStatusCache()
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
        match(key)
          .with('rev-parse --is-inside-work-tree', () => cb(null, 'true\n', ''))
          .with('rev-parse --abbrev-ref HEAD', () => cb(null, 'main\n', ''))
          .with(
            'for-each-ref --format=%(refname)%09%(refname:short)%09%(upstream:short)%09%(HEAD)%09%(upstream:track) refs/heads refs/remotes',
            () =>
              cb(
                null,
                [
                  'refs/heads/main\tmain\torigin/main\t*\t[ahead 2, behind 1]',
                  'refs/heads/feature\tfeature\torigin/feature\t\t',
                  'refs/remotes/origin/main\torigin/main\t\t\t',
                  'refs/remotes/origin/HEAD\torigin/HEAD\t\t\t',
                ].join('\n'),
                '',
              ),
          )
          .otherwise(() => cb(new Error(`Unexpected git command: ${key}`), '', ''))
      },
    )

    registerGitHandlers()
    const handler = registeredHandler('git:branches:list')
    expect(handler).toBeDefined()

    const result = await handler?.({}, '/tmp/repo')

    expect(result).toMatchObject({
      currentBranch: 'main',
      branches: [
        { name: 'feature' },
        { name: 'main', isRemote: false, isCurrent: true, ahead: 2, behind: 1 },
        { name: 'origin/main' },
      ],
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

    const result = await handler?.({}, '/tmp/repo', { name: 'origin/feature' })

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

  it('fails remote checkout when local branch exists with different upstream', async () => {
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
        if (key === 'show-ref --verify --quiet refs/remotes/upstream/main') {
          cb(null, '', '')
          return
        }
        if (key === 'show-ref --verify --quiet refs/heads/main') {
          cb(null, '', '')
          return
        }
        if (key === 'for-each-ref --format=%(upstream:short) refs/heads/main') {
          cb(null, 'origin/main\n', '')
          return
        }
        cb(new Error(`Unexpected git command: ${key}`), '', '')
      },
    )

    registerGitHandlers()
    const handler = registeredHandler('git:branches:checkout')
    expect(handler).toBeDefined()

    const result = await handler?.({}, '/tmp/repo', { name: 'upstream/main' })

    expect(result).toEqual({
      ok: false,
      code: 'branch-exists',
      message: 'Local branch "main" already exists and is not tracking "upstream/main".',
    })
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

    const result = await handler?.({}, '/tmp/repo', {
      name: 'main',
      upstream: 'origin/missing',
    })

    expect(result).toEqual({
      ok: false,
      code: 'upstream-not-found',
      message: 'The selected upstream branch does not exist.',
    })
  })
})
