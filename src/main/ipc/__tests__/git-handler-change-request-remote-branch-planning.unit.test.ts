import { beforeEach, describe, expect, it } from 'vitest'
import {
  execFileMock,
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
} from './git-handler.test-harness'
import type { GitCallback } from './git-handler-stacked-gates.test-harness'

describe('change-request branch planning with slash-containing remotes', () => {
  let registerGitHandlers: Awaited<ReturnType<typeof loadGitHandlers>>['registerGitHandlers']

  beforeEach(async () => {
    resetGitHandlerMocks()
    ;({ registerGitHandlers } = await loadGitHandlers())
  })

  it('suffixes a feature ref that already exists behind the longest remote prefix', async () => {
    execFileMock.mockImplementation(
      (command: string, args: string[], _options: unknown, callback: GitCallback) => {
        const joined = args.join(' ')
        if (command === 'gh') {
          callback(null, 'github.com\n  ✓ Logged in to github.com account octocat (keyring)\n', '')
          return
        }
        if (joined === 'rev-parse --is-inside-work-tree') {
          callback(null, 'true\n', '')
          return
        }
        if (joined === 'rev-parse --abbrev-ref HEAD') {
          callback(null, 'main\n', '')
          return
        }
        if (joined.startsWith('for-each-ref ')) {
          callback(
            null,
            'refs/remotes/team/fork/codex/session-summary\tteam/fork/codex/session-summary\t\t\t\t1000\n',
            '',
          )
          return
        }
        if (joined.startsWith('reflog show ')) {
          callback(null, '', '')
          return
        }
        if (joined === 'remote') {
          callback(null, 'origin\nteam\nteam/fork\n', '')
          return
        }
        if (joined === 'remote get-url origin') {
          callback(null, 'git@github.com:openwaggle/openwaggle.git\n', '')
          return
        }
        callback(new Error(`Unexpected Git arguments: ${joined}`), '', '')
      },
    )
    registerGitHandlers()

    const result = await registeredHandler('git:change-request:preflight')?.({}, '/tmp/repo', {
      headRef: 'codex/session-summary',
      baseRef: 'main',
      title: 'Session summary',
      draft: false,
      createFeatureBranch: true,
    })

    expect(result).toMatchObject({ plannedHeadRef: 'codex/session-summary-2' })
  })
})
