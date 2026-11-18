import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
  showMessageBoxMock,
} from './git-handler.test-harness'
import { respondWith } from './git-handler-stacked-gates.test-harness'

describe('stacked push policy gates', () => {
  let registerGitHandlers: Awaited<ReturnType<typeof loadGitHandlers>>['registerGitHandlers']

  beforeEach(async () => {
    resetGitHandlerMocks()
    ;({ registerGitHandlers } = await loadGitHandlers())
  })

  it('hard-blocks a known unsupported push policy before any mutation', async () => {
    const unexpected: string[] = []
    respondWith(
      new Map([
        ['rev-parse --is-inside-work-tree', 'true\n'],
        ['symbolic-ref --quiet --short HEAD', 'feature/session-summary\n'],
        ['remote get-url origin', 'https://github.com/openwaggle/openwaggle.git\n'],
        ['symbolic-ref --quiet --short refs/remotes/origin/HEAD', 'origin/main\n'],
        ['-c core.quotePath=false status --porcelain=v1 -z', ' M src/a.ts\n'],
        ['-c core.quotePath=false diff --numstat -z', '1\t0\tsrc/a.ts\n'],
        ['-c core.quotePath=false diff --cached --numstat -z', ''],
        ['for-each-ref --format=%(push:remotename) refs/heads/feature/session-summary', 'origin\n'],
        ['config --get-all push.default', 'nothing\n'],
      ]),
      (command) => unexpected.push(command),
    )
    registerGitHandlers()

    const result = await registeredHandler('git:stacked-action:run')?.(
      { sender: {} },
      '/tmp/repo-unsupported-push',
      { action: 'commit_push', commitMessage: 'Ship it', paths: ['src/a.ts'] },
    )

    expect(result).toMatchObject({
      ok: false,
      phase: 'push',
      code: 'push-failed',
      message: expect.stringContaining('push.default=nothing'),
    })
    expect(showMessageBoxMock).not.toHaveBeenCalled()
    expect(unexpected).toEqual([])
  })

  it('hard-blocks publishing a detached HEAD before committing', async () => {
    const unexpected: string[] = []
    respondWith(
      new Map([
        ['rev-parse --is-inside-work-tree', 'true\n'],
        ['symbolic-ref --quiet --short HEAD', ''],
        ['remote get-url origin', 'https://github.com/openwaggle/openwaggle.git\n'],
        ['remote get-url --push --all origin', 'https://github.com/openwaggle/openwaggle.git\n'],
        ['symbolic-ref --quiet --short refs/remotes/origin/HEAD', 'origin/main\n'],
        ['-c core.quotePath=false status --porcelain=v1 -z', ' M src/a.ts\n'],
        ['-c core.quotePath=false diff --numstat -z', '1\t0\tsrc/a.ts\n'],
        ['-c core.quotePath=false diff --cached --numstat -z', ''],
      ]),
      (command) => unexpected.push(command),
    )
    registerGitHandlers()

    const result = await registeredHandler('git:stacked-action:run')?.(
      { sender: {} },
      '/tmp/repo-detached-push',
      { action: 'commit_push', commitMessage: 'Ship it', paths: ['src/a.ts'] },
    )

    expect(result).toMatchObject({
      ok: false,
      phase: 'push',
      code: 'push-failed',
      message: expect.stringContaining('detached HEAD'),
    })
    expect(showMessageBoxMock).not.toHaveBeenCalled()
    expect(unexpected).toEqual([])
  })

  it('hard-blocks publication when no Git remote exists', async () => {
    const unexpected: string[] = []
    respondWith(
      new Map([
        ['rev-parse --is-inside-work-tree', 'true\n'],
        ['symbolic-ref --quiet --short HEAD', 'feature/session-summary\n'],
        ['remote get-url origin', ''],
        ['remote', ''],
        ['symbolic-ref --quiet --short refs/remotes/origin/HEAD', ''],
        ['-c core.quotePath=false status --porcelain=v1 -z', ''],
        ['-c core.quotePath=false diff --numstat -z', ''],
        ['-c core.quotePath=false diff --cached --numstat -z', ''],
        ['for-each-ref --format=%(push:remotename) refs/heads/feature/session-summary', ''],
      ]),
      (command) => unexpected.push(command),
    )
    registerGitHandlers()

    const result = await registeredHandler('git:stacked-action:run')?.(
      { sender: {} },
      '/tmp/repo-without-remote',
      { action: 'commit_push', commitMessage: 'Ship it', paths: ['src/a.ts'] },
    )

    expect(result).toMatchObject({
      ok: false,
      phase: 'push',
      code: 'push-failed',
      message: 'Add a Git remote before publishing this branch.',
    })
    expect(showMessageBoxMock).not.toHaveBeenCalled()
    expect(unexpected).toEqual([])
  })
})
