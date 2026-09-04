import { beforeEach, describe, expect, it } from 'vitest'
import {
  execFileMock,
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
  showMessageBoxMock,
} from './git-handler.test-harness'
import { type GitCallback, respondWith } from './git-handler-stacked-gates.test-harness'

describe('stacked action change-request gates', () => {
  let registerGitHandlers: Awaited<ReturnType<typeof loadGitHandlers>>['registerGitHandlers']

  beforeEach(async () => {
    resetGitHandlerMocks()
    ;({ registerGitHandlers } = await loadGitHandlers())
  })

  it('preflights the exact GitHub host and returns a browser fallback without changing git', async () => {
    const mutations: string[] = []
    execFileMock.mockImplementation(
      (command: string, args: string[], _options: unknown, callback: GitCallback) => {
        const joined = args.join(' ')
        if (/\b(switch|checkout|add|commit|push)\b/.test(joined)) mutations.push(joined)
        if (command === 'gh') {
          callback(
            Object.assign(new Error('status reported on stderr'), {
              code: 1,
              stdout:
                'github.example.com\n  ✓ Logged in to github.example.com account octocat (keyring)\n',
              stderr: '',
            }),
            '',
            '',
          )
          return
        }
        if (joined === 'remote get-url origin') {
          callback(null, 'git@github.example.com:openwaggle/openwaggle.git\n', '')
          return
        }
        callback(new Error(`Unexpected Git arguments: ${joined}`), '', '')
      },
    )
    registerGitHandlers()
    const handler = registeredHandler('git:change-request:preflight')

    const result = await handler?.({}, '/tmp/repo', {
      headRef: 'codex/session-summary',
      baseRef: 'main',
      title: 'Session summary',
      body: 'Ready for review.',
      draft: false,
    })

    expect(result).toEqual({
      provider: { id: 'github', host: 'github.example.com' },
      readiness: {
        ok: true,
        status: {
          authenticated: true,
          account: 'octocat',
          host: 'github.example.com',
        },
      },
      browserUrl:
        'https://github.example.com/openwaggle/openwaggle/compare?expand=1&title=Session+summary&body=Ready+for+review.',
    })
    expect(execFileMock).toHaveBeenCalledWith(
      'gh',
      ['auth', 'status', '--active', '--hostname', 'github.example.com'],
      expect.objectContaining({ cwd: '/tmp/repo' }),
      expect.any(Function),
    )
    expect(mutations).toEqual([])
  })

  it('does not ask for default-branch confirmation when the action first creates a feature branch', async () => {
    respondWith(
      new Map([
        ['rev-parse --is-inside-work-tree', 'true\n'],
        ['symbolic-ref --quiet --short HEAD', 'main\n'],
        ['remote get-url origin', 'https://github.com/example/repo.git\n'],
        ['rev-parse --abbrev-ref origin/HEAD', 'origin/main\n'],
        ['-c core.quotePath=false status --porcelain=v1', ''],
        ['-c core.quotePath=false diff --numstat', ''],
        ['-c core.quotePath=false diff --cached --numstat', ''],
        ['rev-parse --abbrev-ref @{upstream}', 'origin/main\n'],
      ]),
    )
    registerGitHandlers()
    const handler = registeredHandler('git:stacked-action:run')

    const result = await handler?.({ sender: {} }, '/tmp/repo', {
      action: 'create_pr',
      createFeatureBranch: true,
      featureBranchName: 'codex/session-summary',
      changeRequestTitle: 'Session Summary',
      changeRequestBody: 'Summary body',
      baseRef: 'main',
      draft: false,
    })

    expect(showMessageBoxMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, phase: 'pr' })
  })

  it('checks GitHub CLI authentication before mutating git for a change request', async () => {
    const mutations: string[] = []
    execFileMock.mockImplementation(
      (command: string, args: string[], _options: unknown, callback: GitCallback) => {
        const joined = args.join(' ')
        if (command === 'gh') {
          callback(
            Object.assign(new Error('not logged in'), {
              code: 1,
              stdout: '',
              stderr: 'You are not logged into any GitHub hosts.',
            }),
            '',
            '',
          )
          return
        }
        if (/\b(switch|checkout|add|commit|push)\b/.test(joined)) mutations.push(joined)
        if (joined === 'rev-parse --is-inside-work-tree') {
          callback(null, 'true\n', '')
          return
        }
        if (joined === 'symbolic-ref --quiet --short HEAD') {
          callback(null, 'main\n', '')
          return
        }
        if (joined.includes('remote get-url')) {
          callback(null, 'https://github.com/example/repo.git\n', '')
          return
        }
        if (joined === 'rev-parse --abbrev-ref origin/HEAD') {
          callback(null, 'origin/main\n', '')
          return
        }
        callback(null, '', '')
      },
    )
    registerGitHandlers()
    const handler = registeredHandler('git:stacked-action:run')

    const result = await handler?.({ sender: {} }, '/tmp/repo', {
      action: 'commit_push_pr',
      commitMessage: 'Ship it',
      createFeatureBranch: true,
      featureBranchName: 'codex/provider-preflight',
      changeRequestTitle: 'Provider preflight',
      paths: ['src/a.ts'],
    })

    expect(result).toMatchObject({
      ok: false,
      phase: 'pr',
      message: expect.stringMatching(/GitHub CLI.*github\.com/i),
      fallbackUrl: expect.stringContaining('https://github.com/example/repo/compare?'),
    })
    expect(result).not.toMatchObject({ fallbackUrl: expect.stringContaining('provider-preflight') })
    expect(mutations).toEqual([])
    expect(execFileMock).toHaveBeenCalledWith(
      'gh',
      ['auth', 'status', '--active', '--hostname', 'github.com'],
      expect.objectContaining({ cwd: '/tmp/repo' }),
      expect.any(Function),
    )
  })
})
