import { beforeEach, describe, expect, it } from 'vitest'
import { execFileMock, resetGitHandlerMocks } from '../../__tests__/git-handler.test-harness'
import { commitGit } from '../commit-handler'

const COMMIT_HASH = '0123456789abcdef0123456789abcdef01234567'

type GitCallback = (
  error: (Error & { readonly code?: number | string; readonly stderr?: string }) | null,
  stdout: string,
  stderr: string,
) => void

function installCommitGit(headResult: (attempt: number, callback: GitCallback) => void) {
  let commitCalls = 0
  let headCalls = 0
  execFileMock.mockImplementation(
    (_command: string, args: string[], _options: unknown, callback: GitCallback) => {
      const joined = args.join(' ')
      if (joined === 'rev-parse --show-toplevel') return callback(null, '/repo\n', '')
      if (joined === 'rev-parse --is-inside-work-tree') return callback(null, 'true\n', '')
      if (
        joined === 'ls-files --unmerged' ||
        args.includes('status') ||
        args.includes('update-index')
      ) {
        return callback(null, '', '')
      }
      if (args.includes('commit')) {
        commitCalls += 1
        return callback(null, '[main 0123456] committed\n', '')
      }
      if (joined === 'rev-parse HEAD') {
        headCalls += 1
        return headResult(headCalls, callback)
      }
      return callback(new Error(`Unexpected Git arguments: ${joined}`), '', '')
    },
  )
  return { commitCalls: () => commitCalls, headCalls: () => headCalls }
}

async function invokeCommit() {
  return commitGit('/repo', {
    message: 'committed',
    amend: false,
    paths: ['src/app.ts'],
  })
}

describe('post-commit HEAD resolution', () => {
  beforeEach(() => {
    resetGitHandlerMocks()
  })

  it('retries a transient execution failure without creating a second commit', async () => {
    const calls = installCommitGit((attempt, callback) => {
      if (attempt === 1) {
        callback(Object.assign(new Error('spawn git EAGAIN'), { code: 'EAGAIN' }), '', '')
        return
      }
      callback(null, `${COMMIT_HASH}\n`, '')
    })
    await expect(invokeCommit()).resolves.toEqual({
      ok: true,
      commitHash: COMMIT_HASH,
      summary: '[main 0123456] committed',
    })
    expect(calls.commitCalls()).toBe(1)
    expect(calls.headCalls()).toBe(2)
  })

  it('reports partial success and suppresses Output identity after bounded failures', async () => {
    const calls = installCommitGit((_attempt, callback) => {
      callback(Object.assign(new Error('spawn git EAGAIN'), { code: 'EAGAIN' }), '', '')
    })
    const result = await invokeCommit()

    expect(result).toMatchObject({
      ok: true,
      commitHash: null,
      commitOutput: {
        ok: false,
        retryPersisted: false,
        message: expect.stringContaining('Do not repeat the commit'),
      },
    })
    expect(calls.commitCalls()).toBe(1)
    expect(calls.headCalls()).toBe(3)
  })
})
