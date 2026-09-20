import { beforeEach, describe, expect, it } from 'vitest'
import {
  execFileMock,
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
  showMessageBoxMock,
} from './git-handler.test-harness'
import type { GitCallback } from './git-handler-stacked-gates.test-harness'

describe('stacked action destination safety gates', () => {
  let registerGitHandlers: Awaited<ReturnType<typeof loadGitHandlers>>['registerGitHandlers']

  beforeEach(async () => {
    resetGitHandlerMocks()
    ;({ registerGitHandlers } = await loadGitHandlers())
  })

  it('aborts when the confirmed branch or push destination changes before mutation', async () => {
    let headReads = 0
    const mutationCommands: string[] = []
    showMessageBoxMock.mockResolvedValue({ response: 1 })
    execFileMock.mockImplementation(
      (_command: string, args: string[], _options: unknown, callback: GitCallback) => {
        const joined = args.join(' ')
        if (joined === 'rev-parse --is-inside-work-tree') return callback(null, 'true\n', '')
        if (joined === 'symbolic-ref --quiet --short HEAD') {
          headReads += 1
          return callback(null, headReads === 1 ? 'main\n' : 'feature\n', '')
        }
        if (joined === 'remote get-url origin') {
          return callback(null, 'https://github.com/example/repo.git\n', '')
        }
        if (joined === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') {
          return callback(null, 'origin/main\n', '')
        }
        if (joined.startsWith('for-each-ref --format=%(push:remotename)')) {
          return joined.endsWith('refs/heads/main')
            ? callback(null, 'origin\n', '')
            : callback(null, 'origin\n', '')
        }
        if (joined === 'config --get-all push.default') {
          return callback(null, 'current\n', '')
        }
        if (joined.startsWith('config --get-all ')) {
          return callback(
            Object.assign(new Error('missing config'), { code: 1, stdout: '', stderr: '' }),
            '',
            '',
          )
        }
        if (joined === 'remote get-url --push --all origin') {
          return callback(null, 'https://github.com/example/repo.git\n', '')
        }
        if (joined.startsWith('-c core.quotePath=false status --porcelain=v1 -z')) {
          return callback(null, ' M a.txt\n', '')
        }
        if (joined.includes('diff ') && joined.includes('--numstat')) return callback(null, '', '')
        mutationCommands.push(joined)
        return callback(new Error(`Unexpected mutation: ${joined}`), '', '')
      },
    )
    registerGitHandlers()
    const handler = registeredHandler('git:stacked-action:run')

    const result = await handler?.({ sender: {} }, '/tmp/repo-changing-target', {
      action: 'commit_push',
      commitMessage: 'Ship it',
      paths: ['a.txt'],
    })

    expect(showMessageBoxMock).toHaveBeenCalledOnce()
    expect(headReads).toBe(2)
    expect(mutationCommands).toEqual([])
    expect(result).toMatchObject({
      ok: false,
      code: 'unknown',
      message: expect.stringContaining('push destination changed'),
    })
  })

  it('aborts when the effective push URL changes after planning', async () => {
    let pushUrlReads = 0
    const unexpected: string[] = []
    execFileMock.mockImplementation(
      (_command: string, args: string[], _options: unknown, callback: GitCallback) => {
        const joined = args.join(' ')
        if (joined === 'rev-parse --is-inside-work-tree') return callback(null, 'true\n', '')
        if (joined === 'symbolic-ref --quiet --short HEAD') {
          return callback(null, 'feature/session\n', '')
        }
        if (joined === 'remote get-url origin') {
          return callback(null, 'https://github.com/example/repo.git\n', '')
        }
        if (joined === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') {
          return callback(null, 'origin/main\n', '')
        }
        if (joined === 'for-each-ref --format=%(push:remotename) refs/heads/feature/session') {
          return callback(null, 'origin\n', '')
        }
        if (
          joined ===
          'for-each-ref --format=%(upstream:remotename)%00%(upstream:remoteref) refs/heads/feature/session'
        ) {
          return callback(null, 'origin\0refs/heads/feature/session\n', '')
        }
        if (joined === 'config --get-all push.default') {
          return callback(null, 'current\n', '')
        }
        if (joined.startsWith('config --get-all ')) {
          return callback(
            Object.assign(new Error('missing config'), { code: 1, stdout: '', stderr: '' }),
            '',
            '',
          )
        }
        if (joined === 'remote get-url --push --all origin') {
          pushUrlReads += 1
          const url =
            pushUrlReads === 1 ? 'https://github.com/example/repo.git' : 'ssh://new.example/repo'
          return callback(null, `${url}\n`, '')
        }
        if (joined === '-c core.quotePath=false status --porcelain=v1 -z') {
          return callback(null, '', '')
        }
        if (
          joined === '-c core.quotePath=false diff --numstat -z' ||
          joined === '-c core.quotePath=false diff --cached --numstat -z'
        ) {
          return callback(null, '', '')
        }
        unexpected.push(joined)
        return callback(new Error(`Unexpected Git command: ${joined}`), '', '')
      },
    )
    registerGitHandlers()

    const result = await registeredHandler('git:stacked-action:run')?.(
      { sender: {} },
      '/tmp/repo-push-url-change',
      { action: 'push' },
    )

    expect(pushUrlReads).toBe(2)
    expect(unexpected).toEqual([])
    expect(result).toMatchObject({
      ok: false,
      code: 'unknown',
      message: expect.stringContaining('push destination changed'),
    })
  })

  it('invalidates a default-ref confirmation when the push URL changes while it is open', async () => {
    let confirmationVisible = false
    let pushUrlReads = 0
    const unexpected: string[] = []
    showMessageBoxMock.mockImplementation(async () => {
      confirmationVisible = true
      return { response: 1 }
    })
    execFileMock.mockImplementation(
      (_command: string, args: string[], _options: unknown, callback: GitCallback) => {
        const joined = args.join(' ')
        if (joined === 'rev-parse --is-inside-work-tree') return callback(null, 'true\n', '')
        if (joined === 'symbolic-ref --quiet --short HEAD') return callback(null, 'main\n', '')
        if (joined === 'remote get-url origin') {
          return callback(null, 'https://github.com/example/repo.git\n', '')
        }
        if (joined === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') {
          return callback(null, 'origin/main\n', '')
        }
        if (joined === 'for-each-ref --format=%(push:remotename) refs/heads/main') {
          return callback(null, 'origin\n', '')
        }
        if (joined === 'config --get-all push.default') {
          return callback(null, 'current\n', '')
        }
        if (joined.startsWith('config --get-all ')) {
          return callback(
            Object.assign(new Error('missing config'), { code: 1, stdout: '', stderr: '' }),
            '',
            '',
          )
        }
        if (joined === 'remote get-url --push --all origin') {
          pushUrlReads += 1
          const url = confirmationVisible ? 'ssh://new.example/repo' : 'ssh://old.example/repo'
          return callback(null, `${url}\n`, '')
        }
        if (joined === '-c core.quotePath=false status --porcelain=v1 -z') {
          return callback(null, '', '')
        }
        if (
          joined === '-c core.quotePath=false diff --numstat -z' ||
          joined === '-c core.quotePath=false diff --cached --numstat -z'
        ) {
          return callback(null, '', '')
        }
        unexpected.push(joined)
        return callback(new Error(`Unexpected Git command: ${joined}`), '', '')
      },
    )
    registerGitHandlers()

    const result = await registeredHandler('git:stacked-action:run')?.(
      { sender: {} },
      '/tmp/repo-push-url-change-during-confirmation',
      { action: 'push' },
    )

    expect(showMessageBoxMock).toHaveBeenCalledOnce()
    expect(pushUrlReads).toBe(2)
    expect(unexpected).toEqual([])
    expect(result).toMatchObject({
      ok: false,
      code: 'unknown',
      message: expect.stringContaining('push destination changed'),
    })
  })

  it('aborts when destination identity cannot be re-read before mutation', async () => {
    let upstreamReads = 0
    const mutations: string[] = []
    execFileMock.mockImplementation(
      (_command: string, args: string[], _options: unknown, callback: GitCallback) => {
        const joined = args.join(' ')
        if (joined === 'rev-parse --is-inside-work-tree') return callback(null, 'true\n', '')
        if (joined === 'symbolic-ref --quiet --short HEAD') {
          return callback(null, 'feature/session\n', '')
        }
        if (joined === 'remote get-url origin') {
          return callback(null, 'https://github.com/example/repo.git\n', '')
        }
        if (joined === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') {
          return callback(null, 'origin/main\n', '')
        }
        if (joined === 'for-each-ref --format=%(push:remotename) refs/heads/feature/session') {
          upstreamReads += 1
          return upstreamReads === 1
            ? callback(null, 'origin\n', '')
            : callback(new Error('spawn git EAGAIN'), '', 'spawn git EAGAIN')
        }
        if (joined === 'config --get-all push.default') {
          return callback(null, 'current\n', '')
        }
        if (joined.startsWith('config --get-all ')) {
          return callback(
            Object.assign(new Error('missing config'), { code: 1, stdout: '', stderr: '' }),
            '',
            '',
          )
        }
        if (joined === '-c core.quotePath=false status --porcelain=v1 -z') {
          return callback(null, '', '')
        }
        if (
          joined === '-c core.quotePath=false diff --numstat -z' ||
          joined === '-c core.quotePath=false diff --cached --numstat -z'
        ) {
          return callback(null, '', '')
        }
        if (joined === 'remote get-url --push --all origin') {
          return callback(null, 'https://github.com/example/repo.git\n', '')
        }
        mutations.push(joined)
        return callback(new Error(`Unexpected mutation: ${joined}`), '', '')
      },
    )
    registerGitHandlers()

    const result = await registeredHandler('git:stacked-action:run')?.(
      { sender: {} },
      '/tmp/repo-upstream-read-failure',
      { action: 'push' },
    )

    expect(upstreamReads).toBe(2)
    expect(showMessageBoxMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: false,
      code: 'unknown',
      message: expect.stringContaining('push destination changed'),
    })
    expect(mutations).toEqual([])
  })
})
