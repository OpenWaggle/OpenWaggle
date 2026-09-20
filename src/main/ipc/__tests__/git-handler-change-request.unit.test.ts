import { beforeEach, describe, expect, it } from 'vitest'
import {
  execFileMock,
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
} from './git-handler.test-harness'

type GitCallback = (error: Error | null, stdout: string, stderr: string) => void

describe('change request adoption', () => {
  let registerGitHandlers: Awaited<ReturnType<typeof loadGitHandlers>>['registerGitHandlers']
  let commands: string[]

  beforeEach(async () => {
    resetGitHandlerMocks()
    commands = []
    execFileMock.mockImplementation(
      (command: string, args: string[], _options: unknown, callback: GitCallback) => {
        commands.push(args.join(' '))
        if (command === 'git' && args.join(' ') === 'remote get-url origin') {
          callback(null, 'git@github.com:example/repo.git\n', '')
          return
        }
        callback(null, '', '')
      },
    )
    ;({ registerGitHandlers } = await loadGitHandlers())
  })

  it('fetches the ref without touching any working tree when adoption is fetch', async () => {
    /*
     * A worktree-mode session only needs the change-request ref as a base for its own tree. The
     * handler used to always run the provider's checkout, which switched the user's opened
     * checkout to that branch - a tree the session never runs in - and would fail or leave
     * partial state on a dirty checkout.
     */
    registerGitHandlers()
    const handler = registeredHandler('git:change-request:checkout')

    const result = await handler?.(
      {},
      '/tmp/repo',
      'https://github.com/example/repo/pull/163',
      'fetch',
    )

    /*
     * Fetched by change-request number, not by head branch name. The branch only exists on the
     * repository's primary remote for a same-repository change request; for a fork the old refspec
     * either failed outright or - worse - silently succeeded against an unrelated branch of the
     * same name and handed the session the wrong base. Both providers publish the real head under a
     * numbered ref.
     */
    expect(result).toEqual({ ok: true, reference: 'refs/openwaggle/change-requests/163' })
    expect(commands).toEqual([
      'remote get-url origin',
      'fetch origin +refs/pull/163/head:refs/openwaggle/change-requests/163',
    ])
    // Nothing that could move HEAD or the index.
    expect(commands.some((entry) => /^(checkout|switch|reset|restore)\b/.test(entry))).toBe(false)
  })

  it('reports a failed fetch as a typed failure', async () => {
    execFileMock.mockImplementation(
      (command: string, args: string[], _options: unknown, callback: GitCallback) => {
        commands.push(args.join(' '))
        if (command === 'git' && args.join(' ') === 'remote get-url origin') {
          callback(null, 'git@github.com:example/repo.git\n', '')
          return
        }
        callback(
          Object.assign(new Error('fetch failed'), { code: 1, stderr: 'no such ref' }),
          '',
          '',
        )
      },
    )
    registerGitHandlers()
    const handler = registeredHandler('git:change-request:checkout')

    const result = await handler?.(
      {},
      '/tmp/repo',
      'https://github.com/example/repo/pull/999',
      'fetch',
    )

    expect(result).toMatchObject({ ok: false, code: 'unknown', message: 'no such ref' })
  })

  it('refuses a reference it cannot identify rather than fetching a same-named branch', async () => {
    registerGitHandlers()
    const handler = registeredHandler('git:change-request:checkout')

    const result = await handler?.({}, '/tmp/repo', 'feature/pr-branch', 'fetch')

    expect(result).toMatchObject({ ok: false, code: 'unknown' })
    expect(commands).toEqual(['remote get-url origin'])
  })

  it.each([
    'https://github.com/other/repo/pull/7',
    'https://github.com/example/other/pull/7',
    'https://github.example.com/example/repo/pull/7',
    'https://gitlab.com/example/repo/-/merge_requests/7',
  ])('refuses to fetch a change request outside the exact repository (%s)', async (url) => {
    registerGitHandlers()
    const handler = registeredHandler('git:change-request:checkout')

    const result = await handler?.({}, '/tmp/repo', url, 'fetch')

    expect(result).toMatchObject({
      ok: false,
      code: 'unknown',
      message: 'The change request does not belong to this repository.',
    })
    expect(commands).toEqual(['remote get-url origin'])
  })

  it('lists GitHub pull requests when the repository only has an upstream remote', async () => {
    const executions: Array<{ readonly command: string; readonly args: string }> = []
    execFileMock.mockImplementation(
      (command: string, args: string[], _options: unknown, callback: GitCallback) => {
        const joined = args.join(' ')
        executions.push({ command, args: joined })
        if (command === 'git' && joined === 'remote get-url origin') {
          callback(
            Object.assign(new Error('missing origin'), {
              code: 2,
              stderr: "error: No such remote 'origin'",
            }),
            '',
            '',
          )
          return
        }
        if (command === 'git' && joined === 'remote') {
          callback(null, 'upstream\n', '')
          return
        }
        if (command === 'git' && joined === 'remote get-url upstream') {
          callback(null, 'git@github.com:example/repo.git\n', '')
          return
        }
        if (command === 'gh') {
          callback(
            null,
            JSON.stringify([
              {
                title: 'Upstream PR',
                url: 'https://github.com/example/repo/pull/7',
                baseRefName: 'main',
                headRefName: 'feature',
                state: 'OPEN',
                isDraft: false,
              },
            ]),
            '',
          )
          return
        }
        callback(new Error(`Unexpected command: ${command} ${joined}`), '', '')
      },
    )
    registerGitHandlers()
    const handler = registeredHandler('git:change-request:list')

    const result = await handler?.({}, '/tmp/repo')

    expect(result).toMatchObject({ ok: true })
    expect(executions).toContainEqual({
      command: 'gh',
      args: expect.stringMatching(/^pr list /),
    })
  })

  it('checks out a GitLab merge request when the repository only has an upstream remote', async () => {
    const executions: Array<{ readonly command: string; readonly args: string }> = []
    execFileMock.mockImplementation(
      (command: string, args: string[], _options: unknown, callback: GitCallback) => {
        const joined = args.join(' ')
        executions.push({ command, args: joined })
        if (command === 'git' && joined === 'remote get-url origin') {
          callback(
            Object.assign(new Error('missing origin'), {
              code: 2,
              stderr: "error: No such remote 'origin'",
            }),
            '',
            '',
          )
          return
        }
        if (command === 'git' && joined === 'remote') {
          callback(null, 'upstream\n', '')
          return
        }
        if (command === 'git' && joined === 'remote get-url upstream') {
          callback(null, 'git@gitlab.com:example/repo.git\n', '')
          return
        }
        if (
          command === 'glab' &&
          joined === 'mr checkout 7 --repo https://gitlab.com/example/repo'
        ) {
          callback(null, '', '')
          return
        }
        callback(new Error(`Unexpected command: ${command} ${joined}`), '', '')
      },
    )
    registerGitHandlers()
    const handler = registeredHandler('git:change-request:checkout')

    const result = await handler?.({}, '/tmp/repo', '7', 'checkout')

    expect(result).toEqual({ ok: true, reference: '7' })
    expect(executions).toContainEqual({
      command: 'glab',
      args: 'mr checkout 7 --repo https://gitlab.com/example/repo',
    })
  })

  it.each([
    ['GitHub', 'git@github.com:example/repo.git', 'https://github.com/example/repo/pull/7'],
    [
      'GitLab',
      'git@gitlab.com:example/repo.git',
      'https://gitlab.com/example/repo/-/merge_requests/7',
    ],
  ])(
    'fetches %s change requests through the sole upstream remote',
    async (_name, remoteUrl, url) => {
      execFileMock.mockImplementation(
        (command: string, args: string[], _options: unknown, callback: GitCallback) => {
          const joined = args.join(' ')
          commands.push(joined)
          if (command === 'git' && joined === 'remote get-url origin') {
            callback(
              Object.assign(new Error('missing origin'), {
                code: 2,
                stderr: "error: No such remote 'origin'",
              }),
              '',
              '',
            )
            return
          }
          if (command === 'git' && joined === 'remote') {
            callback(null, 'upstream\n', '')
            return
          }
          if (command === 'git' && joined === 'remote get-url upstream') {
            callback(null, `${remoteUrl}\n`, '')
            return
          }
          if (command === 'git' && joined.startsWith('fetch upstream ')) {
            callback(null, '', '')
            return
          }
          callback(new Error(`Unexpected command: ${command} ${joined}`), '', '')
        },
      )
      registerGitHandlers()
      const handler = registeredHandler('git:change-request:checkout')

      const result = await handler?.({}, '/tmp/repo', url, 'fetch')

      expect(result).toEqual({ ok: true, reference: 'refs/openwaggle/change-requests/7' })
      expect(commands).toContain(
        url.includes('github.com')
          ? 'fetch upstream +refs/pull/7/head:refs/openwaggle/change-requests/7'
          : 'fetch upstream +refs/merge-requests/7/head:refs/openwaggle/change-requests/7',
      )
    },
  )
})
