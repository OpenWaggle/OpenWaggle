import { beforeEach, describe, expect, it } from 'vitest'
import {
  GIT_SELECTED_PATH_BYTE_LIMIT,
  GIT_SELECTED_PATH_COUNT_LIMIT,
} from '../git/commit-path-contract'
import {
  execFileMock,
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
} from './git-handler.test-harness'

describe('Git selected path IPC limits', () => {
  let registerGitHandlers: Awaited<ReturnType<typeof loadGitHandlers>>['registerGitHandlers']

  beforeEach(async () => {
    resetGitHandlerMocks()
    ;({ registerGitHandlers } = await loadGitHandlers())
    registerGitHandlers()
  })

  it('rejects an excessive commit path count before running Git', async () => {
    const paths = Array.from(
      { length: GIT_SELECTED_PATH_COUNT_LIMIT + 1 },
      (_unused, index) => `src/${String(index)}.ts`,
    )

    await expect(
      registeredHandler('git:commit')?.({}, '/tmp/repo', {
        message: 'too many',
        amend: false,
        paths,
      }),
    ).rejects.toThrow()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('rejects excessive aggregate commit path bytes before running Git', async () => {
    await expect(
      registeredHandler('git:commit')?.({}, '/tmp/repo', {
        message: 'too large',
        amend: false,
        paths: ['x'.repeat(GIT_SELECTED_PATH_BYTE_LIMIT)],
      }),
    ).rejects.toThrow()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('rejects an excessive stacked-action path count before running Git', async () => {
    const paths = Array.from(
      { length: GIT_SELECTED_PATH_COUNT_LIMIT + 1 },
      (_unused, index) => `src/${String(index)}.ts`,
    )

    await expect(
      registeredHandler('git:stacked-action:run')?.({ sender: { id: 1 } }, '/tmp/repo', {
        action: 'commit',
        commitMessage: 'too many',
        paths,
      }),
    ).rejects.toThrow()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('rejects excessive aggregate stacked-action path bytes before running Git', async () => {
    await expect(
      registeredHandler('git:stacked-action:run')?.({ sender: { id: 1 } }, '/tmp/repo', {
        action: 'commit',
        commitMessage: 'too large',
        paths: ['x'.repeat(GIT_SELECTED_PATH_BYTE_LIMIT)],
      }),
    ).rejects.toThrow()
    expect(execFileMock).not.toHaveBeenCalled()
  })
})
