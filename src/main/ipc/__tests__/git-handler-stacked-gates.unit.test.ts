import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
  showMessageBoxMock,
} from './git-handler.test-harness'
import { respondWith } from './git-handler-stacked-gates.test-harness'

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
})
