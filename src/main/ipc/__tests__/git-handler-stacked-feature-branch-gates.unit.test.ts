import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
  showMessageBoxMock,
} from './git-handler.test-harness'
import { respondWith } from './git-handler-stacked-gates.test-harness'

describe('stacked action feature branch safety gates', () => {
  let registerGitHandlers: Awaited<ReturnType<typeof loadGitHandlers>>['registerGitHandlers']

  beforeEach(async () => {
    resetGitHandlerMocks()
    ;({ registerGitHandlers } = await loadGitHandlers())
  })

  it('asks when a requested feature branch normalizes to the default ref', async () => {
    const unexpected: string[] = []
    respondWith(
      new Map([
        ['rev-parse --is-inside-work-tree', 'true\n'],
        ['symbolic-ref --quiet --short HEAD', 'feature/main\n'],
        ['remote get-url origin', 'https://github.com/example/repo.git\n'],
        ['symbolic-ref --quiet --short refs/remotes/origin/HEAD', 'origin/feature/main\n'],
        ['-c core.quotePath=false status --porcelain=v1 -z', ''],
        ['-c core.quotePath=false diff --numstat -z', ''],
        ['-c core.quotePath=false diff --cached --numstat -z', ''],
        ['for-each-ref --format=%(push:remotename) refs/heads/feature/main', 'origin\n'],
        ['remote get-url --push --all origin', 'https://github.com/example/repo.git\n'],
      ]),
      (args) => unexpected.push(args),
    )
    registerGitHandlers()
    const handler = registeredHandler('git:stacked-action:run')

    const result = await handler?.({ sender: {} }, '/tmp/repo-normalized-feature', {
      action: 'create_pr',
      createFeatureBranch: true,
      featureBranchName: 'main',
      changeRequestTitle: 'Session Summary',
      changeRequestBody: 'Summary body',
      baseRef: 'feature/main',
      draft: false,
    })

    expect(unexpected).toEqual([])
    expect(showMessageBoxMock).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ ok: false, code: 'cancelled' })
  })

  it('asks before creating a branch when a distinct push URL makes its default unknown', async () => {
    respondWith(
      new Map([
        ['rev-parse --is-inside-work-tree', 'true\n'],
        ['symbolic-ref --quiet --short HEAD', 'main\n'],
        ['remote get-url origin', 'https://github.com/example/upstream.git\n'],
        ['symbolic-ref --quiet --short refs/remotes/origin/HEAD', 'origin/main\n'],
        ['-c core.quotePath=false status --porcelain=v1 -z', ''],
        ['-c core.quotePath=false diff --numstat -z', ''],
        ['-c core.quotePath=false diff --cached --numstat -z', ''],
        ['for-each-ref --format=%(push:remotename) refs/heads/main', 'origin\n'],
        ['for-each-ref --format=%(push:remotename) refs/heads/feature/new-work', ''],
        ['remote get-url --push --all origin', 'ssh://fork.example/project.git\n'],
      ]),
    )
    registerGitHandlers()

    const result = await registeredHandler('git:stacked-action:run')?.(
      { sender: {} },
      '/tmp/repo-unknown-push-default',
      {
        action: 'commit_push',
        createFeatureBranch: true,
        featureBranchName: 'new-work',
        commitMessage: 'Ship it',
        paths: ['src/a.ts'],
      },
    )

    expect(showMessageBoxMock).toHaveBeenCalledOnce()
    expect(showMessageBoxMock.mock.calls[0]?.[1]).toMatchObject({
      message: 'Commit & push to default ref?',
    })
    expect(result).toMatchObject({ ok: false, code: 'cancelled' })
  })

  it("uses the prospective push remote's default for a new branch", async () => {
    respondWith(
      new Map([
        ['rev-parse --is-inside-work-tree', 'true\n'],
        ['symbolic-ref --quiet --short HEAD', 'main\n'],
        ['remote get-url origin', 'https://github.com/example/upstream.git\n'],
        ['remote get-url fork', 'https://github.com/example/fork.git\n'],
        ['symbolic-ref --quiet --short refs/remotes/origin/HEAD', 'origin/main\n'],
        ['symbolic-ref --quiet --short refs/remotes/fork/HEAD', 'fork/develop\n'],
        ['-c core.quotePath=false status --porcelain=v1 -z', ''],
        ['-c core.quotePath=false diff --numstat -z', ''],
        ['-c core.quotePath=false diff --cached --numstat -z', ''],
        ['for-each-ref --format=%(push:remotename) refs/heads/main', 'fork\n'],
        ['for-each-ref --format=%(push:remotename) refs/heads/develop', ''],
        ['config --get-all remote.pushDefault', 'fork\n'],
        ['remote get-url --push --all fork', 'https://github.com/example/fork.git\n'],
      ]),
    )
    registerGitHandlers()

    const result = await registeredHandler('git:stacked-action:run')?.(
      { sender: {} },
      '/tmp/repo-fork-default',
      {
        action: 'push',
        createFeatureBranch: true,
        featureBranchName: 'develop',
        exactFeatureBranchName: true,
      },
    )

    expect(showMessageBoxMock).toHaveBeenCalledOnce()
    expect(showMessageBoxMock.mock.calls[0]?.[1]).toMatchObject({
      message: 'Push to default ref?',
      detail: expect.stringContaining('"develop"'),
    })
    expect(result).toMatchObject({ ok: false, code: 'cancelled' })
  })
})
