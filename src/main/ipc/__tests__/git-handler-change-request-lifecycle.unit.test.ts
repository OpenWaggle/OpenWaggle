import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  details,
  lifecycleMocks,
  registeredHandler,
  resetLifecycleHandlers,
} from './git-handler-change-request-lifecycle.test-harness'

describe('session-bound change request lifecycle handlers', () => {
  beforeEach(resetLifecycleHandlers)

  it('rejects another Session working path before provider access', async () => {
    lifecycleMocks.verifySessionWorkingPath.mockReturnValue(false)
    const handler = registeredHandler('git:change-request:panel')

    await expect(
      handler?.({}, 'session-a', '/repo/session-b', 'https://github.com/o/r/pull/7'),
    ).resolves.toMatchObject({ ok: false, code: 'invalid-target' })
    expect(lifecycleMocks.resolveSourceControlProvider).not.toHaveBeenCalled()
  })

  it('returns multiple same-repository requests and the selected identity', async () => {
    const handler = registeredHandler('git:change-request:panel')

    const result = await handler?.(
      {},
      'session-a',
      '/repo/session-a',
      'https://github.com/o/r/pull/7?diff=split',
    )

    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        currentRef: 'feat',
        selected: { reference: '7' },
        changeRequests: [{ title: 'Feature' }, { title: 'Second' }],
      },
    })
    expect(lifecycleMocks.getChangeRequestDetails).toHaveBeenCalledWith('/repo/session-a', '7')
    expect(lifecycleMocks.listResourcePage).toHaveBeenCalledWith('session-a', {
      view: 'change-requests',
      limit: 50,
    })
  })

  it('authorizes a selected owned request beyond the first bounded catalog page', async () => {
    lifecycleMocks.listResourcePage.mockReturnValue(
      Effect.succeed({ resources: [], total: 51, nextCursor: 'next', orderRevision: 'r1' }),
    )
    lifecycleMocks.findResourceByLocator.mockReturnValue(
      Effect.succeed({
        kind: 'change-request',
        isOutput: true,
        locator: 'https://github.com/o/r/pull/8',
      }),
    )
    lifecycleMocks.getChangeRequestDetails.mockResolvedValue({
      ok: true,
      changeRequest: details({
        title: 'Second',
        url: 'https://github.com/o/r/pull/8',
        reference: '8',
      }),
    })
    const handler = registeredHandler('git:change-request:panel')

    await expect(
      handler?.({}, 'session-a', '/repo/session-a', 'https://github.com/o/r/pull/8'),
    ).resolves.toMatchObject({ ok: true, snapshot: { selected: { reference: '8' } } })
    expect(lifecycleMocks.findResourceByLocator).toHaveBeenCalledWith(
      'session-a',
      'change-request',
      'https://github.com/o/r/pull/8',
    )
  })

  it('does not authorize a source-only change-request resource', async () => {
    lifecycleMocks.listResourcePage.mockReturnValue(
      Effect.succeed({
        resources: [
          {
            kind: 'change-request',
            isOutput: false,
            locator: 'https://github.com/o/r/pull/99',
          },
        ],
      }),
    )
    lifecycleMocks.findResourceByLocator.mockReturnValue(
      Effect.succeed({
        kind: 'change-request',
        isOutput: false,
        locator: 'https://github.com/o/r/pull/99',
      }),
    )
    const handler = registeredHandler('git:change-request:panel')

    await expect(
      handler?.({}, 'session-a', '/repo/session-a', 'https://github.com/o/r/pull/99'),
    ).resolves.toMatchObject({ ok: false, code: 'invalid-target' })
    expect(lifecycleMocks.getChangeRequestDetails).not.toHaveBeenCalled()
  })

  it('rejects an unrelated request from the same repository', async () => {
    const handler = registeredHandler('git:change-request:panel')

    await expect(
      handler?.({}, 'session-a', '/repo/session-a', 'https://github.com/o/r/pull/99'),
    ).resolves.toMatchObject({ ok: false, code: 'invalid-target' })
    expect(lifecycleMocks.getChangeRequestDetails).not.toHaveBeenCalled()
  })

  it('revalidates Session, identity, and head after confirmation before merging', async () => {
    lifecycleMocks.showMessageBox.mockResolvedValue({ response: 1 })
    const handler = registeredHandler('git:change-request:merge')

    await expect(
      handler?.({ sender: {} }, 'session-a', '/repo/session-a', {
        url: 'https://github.com/o/r/pull/7',
        expectedHeadCommit: 'abc123',
        method: 'squash',
      }),
    ).resolves.toMatchObject({ ok: true, changeRequest: { state: 'merged' } })

    expect(lifecycleMocks.verifySessionWorkingPath).toHaveBeenCalledTimes(2)
    expect(lifecycleMocks.getChangeRequestDetails).toHaveBeenCalledTimes(2)
    expect(lifecycleMocks.mergeChangeRequest).toHaveBeenCalledWith(
      '/repo/session-a',
      '7',
      'squash',
      'abc123',
    )
  })

  it('fails closed when the head moves while the confirmation is open', async () => {
    lifecycleMocks.showMessageBox.mockResolvedValue({ response: 1 })
    lifecycleMocks.getChangeRequestDetails
      .mockResolvedValueOnce({ ok: true, changeRequest: details() })
      .mockResolvedValueOnce({ ok: true, changeRequest: details({ headCommit: 'moved' }) })
    const handler = registeredHandler('git:change-request:merge')

    await expect(
      handler?.({ sender: {} }, 'session-a', '/repo/session-a', {
        url: 'https://github.com/o/r/pull/7',
        expectedHeadCommit: 'abc123',
        method: 'merge',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'invalid-target',
      message: expect.stringContaining('head changed'),
    })
    expect(lifecycleMocks.mergeChangeRequest).not.toHaveBeenCalled()
  })

  it('rejects a merge method that the provider does not report as available', async () => {
    lifecycleMocks.getChangeRequestDetails.mockResolvedValue({
      ok: true,
      changeRequest: details({ merge: { allowed: true, reason: null, methods: ['merge'] } }),
    })
    const handler = registeredHandler('git:change-request:merge')

    await expect(
      handler?.({ sender: {} }, 'session-a', '/repo/session-a', {
        url: 'https://github.com/o/r/pull/7',
        expectedHeadCommit: 'abc123',
        method: 'rebase',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'invalid-target',
      message: expect.stringContaining('does not support'),
    })
    expect(lifecycleMocks.showMessageBox).not.toHaveBeenCalled()
    expect(lifecycleMocks.mergeChangeRequest).not.toHaveBeenCalled()
  })

  it('does not merge when the native confirmation is cancelled', async () => {
    const handler = registeredHandler('git:change-request:merge')

    await expect(
      handler?.({ sender: {} }, 'session-a', '/repo/session-a', {
        url: 'https://github.com/o/r/pull/7',
        expectedHeadCommit: 'abc123',
        method: 'merge',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'cancelled' })
    expect(lifecycleMocks.mergeChangeRequest).not.toHaveBeenCalled()
  })
})
