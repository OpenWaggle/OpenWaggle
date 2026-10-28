import { SessionId } from '@shared/types/brand'
import type { GitRunStackedActionResult } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invokeConfiguredHostUi: vi.fn(),
}))

vi.mock('../../../application/gui-session-command-router', () => ({
  invokeConfiguredHostUi: mocks.invokeConfiguredHostUi,
}))

const { recordStackedActionOutputsWhereOwned, verifySessionGitContext } = await import(
  '../session-git-host'
)

function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect)
}

const SESSION = SessionId('session-a')
const OCCURRENCE = { nodeId: 'node-1', branchId: 'branch-1', createdAt: 1 }

describe('Session-scoped Git work from the desktop window', () => {
  beforeEach(() => {
    mocks.invokeConfiguredHostUi.mockReset()
  })

  it('asks the Session Host whether the working path is the Session’s', async () => {
    mocks.invokeConfiguredHostUi.mockResolvedValue({
      handled: true,
      result: { owned: true, occurrence: OCCURRENCE },
    })

    await expect(run(verifySessionGitContext(SESSION, '/work/acme'))).resolves.toEqual({
      owned: true,
      occurrence: OCCURRENCE,
    })
    expect(mocks.invokeConfiguredHostUi).toHaveBeenCalledWith('git:session:verify-working-path', [
      SESSION,
      '/work/acme',
    ])
  })

  it('never answers itself: the window has no Session store (A-F5)', async () => {
    mocks.invokeConfiguredHostUi.mockResolvedValue({ handled: false })

    await expect(run(verifySessionGitContext(SESSION, '/work/acme'))).rejects.toThrow(
      'not attached to the Session Host',
    )
  })

  it('records a stacked action’s commit and created request in the Session Host', async () => {
    mocks.invokeConfiguredHostUi.mockResolvedValue({
      handled: true,
      result: { commitOutput: { ok: true }, changeRequestOutput: { ok: true } },
    })
    const result: GitRunStackedActionResult = {
      ok: true,
      action: 'commit_push_pr',
      branch: { status: 'unchanged', name: 'feature' },
      commit: { commitHash: 'abc123', summary: 'Fix' },
      changeRequest: {
        title: 'Fix',
        url: 'https://github.com/acme/app/pull/7',
        baseRef: 'main',
        headRef: 'feature',
        state: 'open',
      },
    }

    await expect(
      run(recordStackedActionOutputsWhereOwned(result, SESSION, OCCURRENCE)),
    ).resolves.toMatchObject({ commitOutput: { ok: true }, changeRequestOutput: { ok: true } })
    expect(mocks.invokeConfiguredHostUi).toHaveBeenCalledWith('git:session:record-outputs', [
      SESSION,
      {
        occurrence: OCCURRENCE,
        commit: { commitHash: 'abc123', summary: 'Fix' },
        changeRequest: { title: 'Fix', url: 'https://github.com/acme/app/pull/7' },
      },
    ])
  })

  it('reports a commit without a full hash instead of recording it', async () => {
    const result: GitRunStackedActionResult = {
      ok: true,
      action: 'commit',
      branch: { status: 'unchanged', name: 'feature' },
      commit: { commitHash: null, summary: 'Fix' },
      changeRequest: null,
    }

    await expect(
      run(recordStackedActionOutputsWhereOwned(result, SESSION, OCCURRENCE)),
    ).resolves.toMatchObject({ commitOutput: { ok: false, retryPersisted: false } })
    expect(mocks.invokeConfiguredHostUi).not.toHaveBeenCalled()
  })

  it.each([
    [
      'the Host call fails',
      () => mocks.invokeConfiguredHostUi.mockRejectedValue(new Error('Host gone')),
    ],
    [
      'the Host answers something unexpected',
      () =>
        mocks.invokeConfiguredHostUi.mockResolvedValue({
          handled: true,
          result: 'not a recording',
        }),
    ],
  ])(
    'keeps a successful push and request when %s, reporting the Outputs as unrecorded',
    async (_case, arrange) => {
      arrange()
      const result: GitRunStackedActionResult = {
        ok: true,
        action: 'commit_push_pr',
        branch: { status: 'unchanged', name: 'feature' },
        commit: { commitHash: 'abc123', summary: 'Fix' },
        changeRequest: {
          title: 'Fix',
          url: 'https://github.com/acme/app/pull/7',
          baseRef: 'main',
          headRef: 'feature',
          state: 'open',
        },
      }

      await expect(
        run(recordStackedActionOutputsWhereOwned(result, SESSION, OCCURRENCE)),
      ).resolves.toMatchObject({
        ok: true,
        changeRequest: { url: 'https://github.com/acme/app/pull/7' },
        commitOutput: { ok: false, retryPersisted: false },
        changeRequestOutput: { ok: false, retryPersisted: false },
      })
    },
  )
})
