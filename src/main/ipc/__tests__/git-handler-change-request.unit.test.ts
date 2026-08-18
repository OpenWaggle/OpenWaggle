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
      (_command: string, args: string[], _options: unknown, callback: GitCallback) => {
        commands.push(args.join(' '))
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

    const result = await handler?.({}, '/tmp/repo', 'feature/pr-branch', 'fetch')

    expect(result).toEqual({ ok: true, reference: 'feature/pr-branch' })
    expect(commands).toEqual([
      'fetch origin +refs/heads/feature/pr-branch:refs/remotes/origin/feature/pr-branch',
    ])
    // Nothing that could move HEAD or the index.
    expect(commands.some((entry) => /^(checkout|switch|reset|restore)\b/.test(entry))).toBe(false)
  })

  it('reports a failed fetch as a typed failure', async () => {
    execFileMock.mockImplementation(
      (_command: string, args: string[], _options: unknown, callback: GitCallback) => {
        commands.push(args.join(' '))
        callback(
          Object.assign(new Error('fetch failed'), { code: 1, stderr: 'no such ref' }),
          '',
          '',
        )
      },
    )
    registerGitHandlers()
    const handler = registeredHandler('git:change-request:checkout')

    const result = await handler?.({}, '/tmp/repo', 'missing', 'fetch')

    expect(result).toMatchObject({ ok: false, code: 'unknown', message: 'no such ref' })
  })
})
