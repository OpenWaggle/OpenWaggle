import { match } from '@diegogbrisa/ts-match'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  execFileMock,
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
  showMessageBoxMock,
} from './git-handler.test-harness'

type GitCallback = (error: Error | null, stdout: string, stderr: string) => void

/** Respond to the git calls a stacked action makes, failing loudly on anything unexpected. */
function respondWith(handlers: ReadonlyMap<string, string>, onUnexpected?: (args: string) => void) {
  execFileMock.mockImplementation(
    (_command: string, args: string[], _options: unknown, callback: GitCallback) => {
      const joined = args.join(' ')
      const canned = handlers.get(joined)
      if (canned !== undefined) {
        callback(null, canned, '')
        return
      }
      onUnexpected?.(joined)
      callback(new Error(`Unexpected Git arguments: ${joined}`), '', '')
    },
  )
}

describe('stacked action safety gates', () => {
  let registerGitHandlers: Awaited<ReturnType<typeof loadGitHandlers>>['registerGitHandlers']

  beforeEach(async () => {
    resetGitHandlerMocks()
    ;({ registerGitHandlers } = await loadGitHandlers())
  })

  it('asks for confirmation when the current ref cannot be read, instead of proceeding', async () => {
    /*
     * The gate runs in main so the renderer cannot bypass it. It used to treat any failure of
     * the status read as "confirmed" and continue straight to staging, committing and pushing.
     * A safety gate that skips itself when it cannot see the repository is not a gate.
     */
    respondWith(new Map([['rev-parse --is-inside-work-tree', 'false\n']]))
    registerGitHandlers()
    const handler = registeredHandler('git:stacked-action:run')

    const result = await handler?.({ sender: {} }, '/tmp/repo', {
      action: 'commit_push',
      commitMessage: 'Ship it',
      paths: ['a.txt'],
    })

    expect(showMessageBoxMock).toHaveBeenCalledTimes(1)
    // Cancel is the mocked answer, so the action must not have run.
    expect(result).toMatchObject({ ok: false, code: 'cancelled' })
  })

  it('refuses to commit when no paths were selected, rather than staging the repository', async () => {
    /*
     * The commit phase used to fall back to `git add --all`, which has no pathspec and so
     * reaches the whole repository - past the opened directory. In local environment mode that
     * swept the user's unrelated in-flight edits into the commit and `commit_push` pushed them.
     */
    const unexpected: string[] = []
    respondWith(
      new Map([
        ['rev-parse --is-inside-work-tree', 'true\n'],
        ['symbolic-ref --quiet --short HEAD', 'feature/x\n'],
        ['status --porcelain=v2 --branch', '# branch.head feature/x\n'],
        // The working-tree probe now runs before the commit phase and must be able to answer.
        ['status --porcelain=v1', ' M a.txt\n'],
        ['remote get-url origin', 'https://github.com/example/repo.git\n'],
        ['rev-parse --abbrev-ref origin/HEAD', 'origin/main\n'],
      ]),
      (args) => unexpected.push(args),
    )
    registerGitHandlers()
    const handler = registeredHandler('git:stacked-action:run')

    const result = await handler?.({ sender: {} }, '/tmp/repo', {
      action: 'commit',
      commitMessage: 'Ship it',
      paths: [],
    })

    expect(result).toMatchObject({ ok: false, code: 'nothing-to-commit' })
    expect(unexpected.filter((args) => args.startsWith('add'))).toEqual([])
  })

  it('stages only the selected paths for a commit', async () => {
    const staged: string[] = []
    execFileMock.mockImplementation(
      (_command: string, args: string[], _options: unknown, callback: GitCallback) => {
        const joined = args.join(' ')
        if (joined.startsWith('add ')) staged.push(joined)
        match(joined)
          .when(
            (value) => value.startsWith('add ') || value.startsWith('commit '),
            () => callback(null, '', ''),
          )
          .when(
            (value) => value === 'rev-parse --is-inside-work-tree',
            () => callback(null, 'true\n', ''),
          )
          .when(
            (value) => value === 'symbolic-ref --quiet --short HEAD',
            () => callback(null, 'feature/x\n', ''),
          )
          .otherwise(() => callback(null, '', ''))
      },
    )
    registerGitHandlers()
    const handler = registeredHandler('git:stacked-action:run')

    await handler?.({ sender: {} }, '/tmp/repo', {
      action: 'commit',
      commitMessage: 'Ship it',
      paths: ['src/a.txt', 'src/b.txt'],
    })

    expect(staged).toEqual(['add -- src/a.txt src/b.txt'])
    expect(staged.some((entry) => entry.includes('--all'))).toBe(false)
  })
})
