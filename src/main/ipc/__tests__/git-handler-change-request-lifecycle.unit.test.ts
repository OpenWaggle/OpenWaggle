import type { VcsChangeRequestDetails } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerGitChangeRequestLifecycleHandlers } from '../git/change-request-lifecycle-handler'

const lifecycleMocks = vi.hoisted(() => ({
  verifySessionWorkingPath: vi.fn(),
  resolveSourceControlProvider: vi.fn(),
  runGit: vi.fn(),
  listChangeRequests: vi.fn(),
  getChangeRequestDetails: vi.fn(),
  mergeChangeRequest: vi.fn(),
  resolveChangeRequestForRef: vi.fn(),
  listResourcePage: vi.fn(),
  findResourceByLocator: vi.fn(),
  typedHandle: vi.fn(),
  showMessageBox: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({ typedHandle: lifecycleMocks.typedHandle }))

vi.mock('../../desktop-ui', () => ({
  browserWindowFromWebContents: vi.fn(() => ({ id: 'owner-window' })),
  showMessageBox: lifecycleMocks.showMessageBox,
}))

vi.mock('../../ports/session-resource-repository', () => ({
  SessionResourceRepository: Effect.succeed({
    listPage: lifecycleMocks.listResourcePage,
    findByLocator: lifecycleMocks.findResourceByLocator,
  }),
}))

vi.mock('../git/session-working-path', () => ({
  verifySessionWorkingPath: (...args: unknown[]) =>
    Effect.succeed(lifecycleMocks.verifySessionWorkingPath(...args)),
}))

vi.mock('../git/change-request-provider', () => ({
  resolveSourceControlProvider: lifecycleMocks.resolveSourceControlProvider,
}))

vi.mock('../git/mutation-lock', () => ({
  withGitMutationLock: (_path: string, effect: unknown) => effect,
}))

vi.mock('../git/shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('../git/shared')>()
  return { ...original, runGit: lifecycleMocks.runGit }
})

function registeredHandler(name: string) {
  const call = lifecycleMocks.typedHandle.mock.calls.find((entry: unknown[]) => entry[0] === name)
  const handler = call?.[1]
  return typeof handler === 'function'
    ? (...args: unknown[]) => Effect.runPromise(handler(...args))
    : undefined
}

function details(overrides: Partial<VcsChangeRequestDetails> = {}): VcsChangeRequestDetails {
  return {
    title: 'Feature',
    url: 'https://github.com/o/r/pull/7',
    baseRef: 'main',
    headRef: 'feat',
    state: 'open',
    reference: '7',
    headCommit: 'abc123',
    author: 'octocat',
    changedFiles: 1,
    additions: 2,
    deletions: 1,
    files: [{ path: 'src/a.ts', additions: 2, deletions: 1 }],
    checks: [],
    reviewDecision: 'approved',
    mergeability: 'mergeable',
    commentsCount: 0,
    reviewsCount: 1,
    reviewThreadsCount: null,
    unresolvedReviewThreadsCount: null,
    merge: { allowed: true, reason: null, methods: ['merge', 'squash', 'rebase'] },
    ...overrides,
  }
}

describe('session-bound change request lifecycle handlers', () => {
  beforeEach(() => {
    lifecycleMocks.typedHandle.mockReset()
    lifecycleMocks.showMessageBox.mockReset().mockResolvedValue({ response: 0 })
    lifecycleMocks.verifySessionWorkingPath.mockReset().mockReturnValue(true)
    lifecycleMocks.runGit.mockReset().mockResolvedValue({
      code: 0,
      stdout: 'feat\n',
      stderr: '',
      missing: false,
    })
    lifecycleMocks.listChangeRequests.mockReset().mockResolvedValue({
      ok: true,
      changeRequests: [
        details(),
        details({ title: 'Second', url: 'https://github.com/o/r/pull/8' }),
        details({ title: 'Foreign', url: 'https://github.com/o/other/pull/9' }),
      ],
    })
    lifecycleMocks.listResourcePage.mockReset().mockReturnValue(
      Effect.succeed({
        resources: [
          { kind: 'change-request', isOutput: true, locator: 'https://github.com/o/r/pull/7' },
          { kind: 'change-request', isOutput: true, locator: 'https://github.com/o/r/pull/8' },
          {
            kind: 'change-request',
            isOutput: true,
            locator: 'https://github.com/o/other/pull/9',
          },
        ],
      }),
    )
    lifecycleMocks.findResourceByLocator.mockReset().mockReturnValue(Effect.succeed(null))
    lifecycleMocks.resolveChangeRequestForRef
      .mockReset()
      .mockResolvedValue({ ok: true, changeRequest: details() })
    lifecycleMocks.getChangeRequestDetails
      .mockReset()
      .mockResolvedValue({ ok: true, changeRequest: details() })
    lifecycleMocks.mergeChangeRequest
      .mockReset()
      .mockResolvedValue({ ok: true, changeRequest: details({ state: 'merged' }) })
    lifecycleMocks.resolveSourceControlProvider.mockReset().mockResolvedValue({
      provider: {
        id: 'github',
        listChangeRequests: lifecycleMocks.listChangeRequests,
        getChangeRequestDetails: lifecycleMocks.getChangeRequestDetails,
        mergeChangeRequest: lifecycleMocks.mergeChangeRequest,
        resolveChangeRequestForRef: lifecycleMocks.resolveChangeRequestForRef,
      },
      info: { id: 'github', host: 'github.com' },
      remoteName: 'origin',
      remoteUrl: 'https://github.com/o/r.git',
    })
    registerGitChangeRequestLifecycleHandlers()
  })

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
