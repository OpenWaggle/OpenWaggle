import { match } from '@diegogbrisa/ts-match'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  execFileMock,
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
} from './git-handler.test-harness'
import { type GitCallback, respondWith } from './git-handler-stacked-gates.test-harness'

describe('stacked action commit path safety', () => {
  let registerGitHandlers: Awaited<ReturnType<typeof loadGitHandlers>>['registerGitHandlers']

  beforeEach(async () => {
    resetGitHandlerMocks()
    ;({ registerGitHandlers } = await loadGitHandlers())
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
        // The working-tree probe now runs before the commit phase and must be able to answer.
        // The path-yielding reads disable git's quoting, so the canned key carries that prefix.
        ['-c core.quotePath=false status --porcelain=v1 -z', ' M a.txt\n'],
        ['-c core.quotePath=false diff --numstat -z', '1\t0\ta.txt\n'],
        ['-c core.quotePath=false diff --cached --numstat -z', ''],
        ['remote get-url origin', 'https://github.com/example/repo.git\n'],
        ['symbolic-ref --quiet --short refs/remotes/origin/HEAD', 'origin/main\n'],
        ['for-each-ref --format=%(push:remotename) refs/heads/feature/x', 'origin\n'],
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
    expect(unexpected.filter((args) => args.includes('add'))).toEqual([])
  })

  it('stages only the selected paths for a commit', async () => {
    const staged: string[] = []
    execFileMock.mockImplementation(
      (_command: string, args: string[], _options: unknown, callback: GitCallback) => {
        const joined = args.join(' ')
        if (joined.includes('update-index ')) staged.push(joined)
        match(joined)
          .when(
            (value) => value.includes('update-index ') || value.includes('commit '),
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
          .when(
            // No merge in progress: `rev-parse --verify` exits non-zero when the ref is absent.
            (value) => value === 'rev-parse -q --verify MERGE_HEAD',
            () => callback(Object.assign(new Error('no MERGE_HEAD'), { code: 1 }), '', ''),
          )
          .otherwise(() => callback(null, '', ''))
      },
    )
    registerGitHandlers()
    const handler = registeredHandler('git:stacked-action:run')

    const result = await handler?.({ sender: {} }, '/tmp/repo', {
      action: 'commit',
      commitMessage: 'Ship it',
      paths: ['src/a.txt', 'src/b.txt'],
    })

    expect(result).toMatchObject({ ok: true })

    expect(staged).toEqual(['--literal-pathspecs update-index --add --remove -z --stdin'])
    expect(staged.some((entry) => entry.includes('--all'))).toBe(false)
  })
})
