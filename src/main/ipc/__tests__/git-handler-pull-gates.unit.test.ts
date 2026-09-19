import { beforeEach, describe, expect, it } from 'vitest'
import {
  execFileMock,
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
  showMessageBoxMock,
} from './git-handler.test-harness'
import type { GitCallback } from './git-handler-stacked-gates.test-harness'

describe('stacked pull safety gate', () => {
  let registerGitHandlers: Awaited<ReturnType<typeof loadGitHandlers>>['registerGitHandlers']

  beforeEach(async () => {
    resetGitHandlerMocks()
    ;({ registerGitHandlers } = await loadGitHandlers())
  })

  it('does not read or reject unrelated push configuration before pulling', async () => {
    const commands: string[] = []
    execFileMock.mockImplementation(
      (_command: string, args: string[], _options: unknown, callback: GitCallback) => {
        const joined = args.join(' ')
        commands.push(joined)
        if (joined === 'rev-parse --is-inside-work-tree') return callback(null, 'true\n', '')
        if (joined === 'symbolic-ref --quiet --short HEAD') {
          return callback(null, 'feature/session-summary\n', '')
        }
        if (joined === 'remote get-url origin') {
          return callback(null, 'https://github.com/openwaggle/openwaggle.git\n', '')
        }
        if (joined === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') {
          return callback(null, 'origin/main\n', '')
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
        if (joined === 'pull --ff-only') return callback(null, 'Already up to date.\n', '')
        return callback(new Error(`Unexpected Git arguments: ${joined}`), '', '')
      },
    )
    registerGitHandlers()

    const result = await registeredHandler('git:stacked-action:run')?.(
      { sender: {} },
      '/tmp/repo-pull',
      { action: 'pull' },
    )

    expect(result).toMatchObject({ ok: true, action: 'pull' })
    expect(showMessageBoxMock).not.toHaveBeenCalled()
    expect(commands.some((command) => command.includes('push'))).toBe(false)
    expect(commands).toContain('pull --ff-only')
  })
})
