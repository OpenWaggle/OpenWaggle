import type { VcsChangeRequestDetails } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { type Mock, vi } from 'vitest'
import { registerGitChangeRequestLifecycleHandlers } from '../git/change-request-lifecycle-handler'

type TestMock = Mock<(...args: unknown[]) => unknown>

interface LifecycleMocks {
  readonly verifySessionWorkingPath: TestMock
  readonly resolveSourceControlProvider: TestMock
  readonly runGit: TestMock
  readonly listChangeRequests: TestMock
  readonly getChangeRequestDetails: TestMock
  readonly mergeChangeRequest: TestMock
  readonly resolveChangeRequestForRef: TestMock
  readonly listResourcePage: TestMock
  readonly findResourceByLocator: TestMock
  readonly typedHandle: TestMock
  /** Which registration kind each channel used: `host` runs in the Session Host when attached. */
  readonly registrationKinds: Map<string, 'host' | 'relaying' | 'window'>
  readonly showMessageBox: TestMock
  readonly invokeConfiguredHostUi: TestMock
}

const hoistedLifecycleMocks: LifecycleMocks = vi.hoisted(() => ({
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
  registrationKinds: new Map(),
  showMessageBox: vi.fn(),
  invokeConfiguredHostUi: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  RelayedHostResult: class {
    constructor(readonly value: unknown) {}
  },
  hostHandle: (channel: string, handler: unknown) => {
    hoistedLifecycleMocks.registrationKinds.set(channel, 'host')
    hoistedLifecycleMocks.typedHandle(channel, handler)
  },
  relayingHandle: (channel: string, handler: unknown) => {
    hoistedLifecycleMocks.registrationKinds.set(channel, 'relaying')
    hoistedLifecycleMocks.typedHandle(channel, handler)
  },
  typedHandle: (channel: string, handler: unknown) => {
    hoistedLifecycleMocks.registrationKinds.set(channel, 'window')
    hoistedLifecycleMocks.typedHandle(channel, handler)
  },
}))

vi.mock('../../application/gui-session-command-router', () => ({
  invokeConfiguredHostUi: hoistedLifecycleMocks.invokeConfiguredHostUi,
}))

vi.mock('../../desktop-ui', () => ({
  browserWindowFromWebContents: vi.fn(() => ({ id: 'owner-window' })),
  showMessageBox: hoistedLifecycleMocks.showMessageBox,
}))

vi.mock('../../ports/session-resource-repository', () => ({
  SessionResourceRepository: Effect.succeed({
    listPage: hoistedLifecycleMocks.listResourcePage,
    findByLocator: hoistedLifecycleMocks.findResourceByLocator,
  }),
}))

vi.mock('../../services/git/session-working-path', () => ({
  verifySessionWorkingPath: (...args: unknown[]) =>
    Effect.succeed(hoistedLifecycleMocks.verifySessionWorkingPath(...args)),
}))

vi.mock('../../services/source-control/change-request-provider', () => ({
  resolveSourceControlProvider: hoistedLifecycleMocks.resolveSourceControlProvider,
}))

vi.mock('../../services/git/mutation-lock', () => ({
  withGitMutationLock: (_path: string, effect: unknown) => effect,
}))

vi.mock('../../adapters/git/run-git', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../adapters/git/run-git')>()
  return { ...original, runGit: hoistedLifecycleMocks.runGit }
})

export const lifecycleMocks: LifecycleMocks = hoistedLifecycleMocks

export function registeredHandler(name: string) {
  const call = hoistedLifecycleMocks.typedHandle.mock.calls.find(
    (entry: unknown[]) => entry[0] === name,
  )
  const handler = call?.[1]
  return typeof handler === 'function'
    ? (...args: unknown[]) => Effect.runPromise(handler(...args))
    : undefined
}

export function details(overrides: Partial<VcsChangeRequestDetails> = {}): VcsChangeRequestDetails {
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

export function resetLifecycleHandlers() {
  hoistedLifecycleMocks.typedHandle.mockReset()
  hoistedLifecycleMocks.registrationKinds.clear()
  hoistedLifecycleMocks.showMessageBox.mockReset().mockResolvedValue({ response: 0 })
  hoistedLifecycleMocks.verifySessionWorkingPath.mockReset().mockReturnValue(true)
  hoistedLifecycleMocks.runGit.mockReset().mockResolvedValue({
    code: 0,
    stdout: 'feat\n',
    stderr: '',
    missing: false,
  })
  hoistedLifecycleMocks.listChangeRequests.mockReset().mockResolvedValue({
    ok: true,
    changeRequests: [
      details(),
      details({ title: 'Second', url: 'https://github.com/o/r/pull/8' }),
      details({ title: 'Foreign', url: 'https://github.com/o/other/pull/9' }),
    ],
  })
  hoistedLifecycleMocks.listResourcePage.mockReset().mockReturnValue(
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
  hoistedLifecycleMocks.findResourceByLocator.mockReset().mockReturnValue(Effect.succeed(null))
  hoistedLifecycleMocks.resolveChangeRequestForRef
    .mockReset()
    .mockResolvedValue({ ok: true, changeRequest: details() })
  hoistedLifecycleMocks.getChangeRequestDetails
    .mockReset()
    .mockResolvedValue({ ok: true, changeRequest: details() })
  hoistedLifecycleMocks.mergeChangeRequest
    .mockReset()
    .mockResolvedValue({ ok: true, changeRequest: details({ state: 'merged' }) })
  hoistedLifecycleMocks.invokeConfiguredHostUi.mockReset().mockResolvedValue({ handled: false })
  hoistedLifecycleMocks.resolveSourceControlProvider.mockReset().mockResolvedValue({
    provider: {
      id: 'github',
      listChangeRequests: hoistedLifecycleMocks.listChangeRequests,
      getChangeRequestDetails: hoistedLifecycleMocks.getChangeRequestDetails,
      mergeChangeRequest: hoistedLifecycleMocks.mergeChangeRequest,
      resolveChangeRequestForRef: hoistedLifecycleMocks.resolveChangeRequestForRef,
      account: () => 'octocat',
      forkParent: async () => ({ ok: true, parent: null }),
      findChangeRequestForForkHead: async () => ({
        ok: false,
        code: 'no-change-request',
        message: 'No pull request found for ref.',
      }),
    },
    info: { id: 'github', host: 'github.com' },
    repository: { provider: 'github', host: 'github.com', owner: 'o', repository: 'r' },
    remoteName: 'origin',
    remoteUrl: 'https://github.com/o/r.git',
    webUrl: 'https://github.com/o/r',
  })
  registerGitChangeRequestLifecycleHandlers()
}
