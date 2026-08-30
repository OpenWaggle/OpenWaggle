import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { type Mock, vi } from 'vitest'
import { EmptyExtensionRuntimeLayer } from '../../application/__tests__/extension-runtime-test-layer'
import { SessionProjectionRepositoryError, SessionResourceStoreError } from '../../errors'
import { AgentKernelService } from '../../ports/agent-kernel-service'
import { ProviderService } from '../../ports/provider-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'
import { SessionResourceCleanupRepository } from '../../ports/session-resource-cleanup-repository'
import { SessionResourceStore } from '../../ports/session-resource-store'
import { SettingsService } from '../../services/settings-service'
import type * as SessionDetailsHandler from '../session-details-handler'

type TestMock = Mock

const mocks = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  cleanupSessionRunMock: vi.fn(),
  createRuntimeSessionMock: vi.fn(async (_input: { readonly projectPath: string }) => ({
    piSessionId: 'pi-session-created',
    piSessionFile: '/tmp/pi-session-created.jsonl',
  })),
  forkRuntimeSessionMock: vi.fn(),
  persistSnapshotMock: vi.fn(),
  listSessionDetailsMock: vi.fn(),
  getSessionDetailMock: vi.fn(),
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  archiveSessionMock: vi.fn(),
  unarchiveSessionMock: vi.fn(),
  listArchivedSessionsMock: vi.fn(),
  updateSessionTitleMock: vi.fn(),
  setAuthorizationModeMock: vi.fn(),
  listPinnedSessionsMock: vi.fn(async () => []),
  pinSessionMock: vi.fn(async () => undefined),
  unpinSessionMock: vi.fn(async () => undefined),
  movePinnedSessionMock: vi.fn(async () => undefined),
  cancelSessionRunsMock: vi.fn(),
  clearAgentPhaseMock: vi.fn(),
  clearStreamBufferMock: vi.fn(),
  emitRunCompletedMock: vi.fn(),
  removeSessionResourcesMock: vi.fn(),
  completeSessionResourceCleanupMock: vi.fn(),
  listPendingSessionResourceCleanupMock: vi.fn(),
}))

export const typedHandleMock: TestMock = mocks.typedHandleMock
export const cleanupSessionRunMock: TestMock = mocks.cleanupSessionRunMock
export const createRuntimeSessionMock: TestMock = mocks.createRuntimeSessionMock
export const forkRuntimeSessionMock: TestMock = mocks.forkRuntimeSessionMock
export const persistSnapshotMock: TestMock = mocks.persistSnapshotMock
export const listSessionDetailsMock: TestMock = mocks.listSessionDetailsMock
export const getSessionDetailMock: TestMock = mocks.getSessionDetailMock
export const createSessionMock: TestMock = mocks.createSessionMock
export const deleteSessionMock: TestMock = mocks.deleteSessionMock
export const archiveSessionMock: TestMock = mocks.archiveSessionMock
export const unarchiveSessionMock: TestMock = mocks.unarchiveSessionMock
export const listArchivedSessionsMock: TestMock = mocks.listArchivedSessionsMock
export const updateSessionTitleMock: TestMock = mocks.updateSessionTitleMock
export const setAuthorizationModeMock: TestMock = mocks.setAuthorizationModeMock
export const listPinnedSessionsMock: TestMock = mocks.listPinnedSessionsMock
export const pinSessionMock: TestMock = mocks.pinSessionMock
export const unpinSessionMock: TestMock = mocks.unpinSessionMock
export const movePinnedSessionMock: TestMock = mocks.movePinnedSessionMock
export const cancelSessionRunsMock: TestMock = mocks.cancelSessionRunsMock
export const clearAgentPhaseMock: TestMock = mocks.clearAgentPhaseMock
export const clearStreamBufferMock: TestMock = mocks.clearStreamBufferMock
export const emitRunCompletedMock: TestMock = mocks.emitRunCompletedMock
export const removeSessionResourcesMock: TestMock = mocks.removeSessionResourcesMock
export const completeSessionResourceCleanupMock: TestMock = mocks.completeSessionResourceCleanupMock

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../agent/session-cleanup', () => ({
  cleanupSessionRun: cleanupSessionRunMock,
}))

vi.mock('../active-agent-runs', () => ({
  cancelSessionRuns: cancelSessionRunsMock,
}))

vi.mock('../../utils/stream-bridge', () => ({
  clearAgentPhase: clearAgentPhaseMock,
  clearStreamBuffer: clearStreamBufferMock,
  emitRunCompleted: emitRunCompletedMock,
}))

const TestSessionProjectionRepoLayer = Layer.succeed(
  SessionProjectionRepository,
  SessionProjectionRepository.of({
    get: (id) =>
      Effect.tryPromise({
        try: async () => getSessionDetailMock(id),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'get', cause }),
      }),
    getOptional: (id) =>
      Effect.tryPromise({
        try: async () => getSessionDetailMock(id),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'getOptional', cause }),
      }),
    list: (limit) =>
      Effect.tryPromise({
        try: async () => listArchivedSessionsMock(limit),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'list', cause }),
      }),
    listDetails: (limit) =>
      Effect.tryPromise({
        try: async () => listSessionDetailsMock(limit),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'listDetails', cause }),
      }),
    create: (input) =>
      Effect.tryPromise({
        try: async () => createSessionMock(input),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'create', cause }),
      }),
    delete: (id) =>
      Effect.tryPromise({
        try: async () => {
          await deleteSessionMock(id)
        },
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'delete', cause }),
      }),
    archive: (id) =>
      Effect.tryPromise({
        try: async () => {
          await archiveSessionMock(id)
        },
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'archive', cause }),
      }),
    unarchive: (id) =>
      Effect.tryPromise({
        try: async () => {
          await unarchiveSessionMock(id)
        },
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'unarchive', cause }),
      }),
    listArchived: () =>
      Effect.tryPromise({
        try: async () => listArchivedSessionsMock(),
        catch: (cause) =>
          new SessionProjectionRepositoryError({ operation: 'listArchived', cause }),
      }),
    updateTitle: (id, title) =>
      Effect.tryPromise({
        try: async () => {
          await updateSessionTitleMock(id, title)
        },
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'updateTitle', cause }),
      }),
    setWorktreePlan: () => Effect.void,
    setAuthorizationMode: (id, authorizationMode) =>
      Effect.tryPromise({
        try: async () => {
          await setAuthorizationModeMock(id, authorizationMode)
        },
        catch: (cause) =>
          new SessionProjectionRepositoryError({ operation: 'setAuthorizationMode', cause }),
      }),
    establishLineage: () => Effect.void,
    setDelegationState: () => Effect.void,
    listTurnCheckpoints: () => Effect.succeed([]),
    getTurnDiff: () => Effect.succeed(null),
    setTurnCheckpointAnchor: () => Effect.void,
    listPinnedSessions: () =>
      Effect.tryPromise({
        try: () => listPinnedSessionsMock(),
        catch: (cause) =>
          new SessionProjectionRepositoryError({ operation: 'listPinnedSessions', cause }),
      }),
    pinSession: (id) =>
      Effect.tryPromise({
        try: () => pinSessionMock(id),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'pinSession', cause }),
      }),
    unpinSession: (id) =>
      Effect.tryPromise({
        try: () => unpinSessionMock(id),
        catch: (cause) =>
          new SessionProjectionRepositoryError({ operation: 'unpinSession', cause }),
      }),
    movePinnedSession: (move) =>
      Effect.tryPromise({
        try: () => movePinnedSessionMock(move),
        catch: (cause) =>
          new SessionProjectionRepositoryError({ operation: 'movePinnedSession', cause }),
      }),
  }),
)

const TestAgentKernelLayer = Layer.succeed(
  AgentKernelService,
  AgentKernelService.of({
    createSession: (input) =>
      Effect.tryPromise({
        try: async () => createRuntimeSessionMock(input),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }),
    run: () => Effect.fail(new Error('agent run not used by session detail handler tests')),
    getContextUsage: () =>
      Effect.fail(new Error('context usage not used by session detail handler tests')),
    compact: () => Effect.fail(new Error('compaction not used by session detail handler tests')),
    navigateTree: () =>
      Effect.fail(new Error('tree navigation not used by session detail handler tests')),
    forkSession: (input) =>
      Effect.tryPromise({
        try: async () => forkRuntimeSessionMock(input),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }),
    getSessionSnapshot: () =>
      Effect.fail(new Error('session snapshot not used by session detail handler tests')),
  }),
)

const TestSessionRepoLayer = Layer.succeed(SessionRepository, {
  list: () => Effect.succeed([]),
  listArchivedBranches: () => Effect.succeed([]),
  getTree: () => Effect.succeed(null),
  listResourceProjectionPage: () =>
    Effect.succeed({ nodes: [], throughCreatedOrder: null, hasMore: false }),
  getWorkspace: () => Effect.succeed(null),
  persistSnapshot: (input) =>
    Effect.sync(() => {
      persistSnapshotMock(input)
    }),
  updateRuntime: () => Effect.void,
  renameBranch: () => Effect.void,
  archiveBranch: () => Effect.void,
  restoreBranch: () => Effect.void,
  updateTreeUiState: () => Effect.void,
  recordActiveRun: () => Effect.void,
  clearActiveRun: () => Effect.void,
  clearInterruptedRuns: () => Effect.void,
  listActiveRunsForRecovery: () => Effect.succeed([]),
  markActiveRunInterrupted: () => Effect.void,
})

const TestProviderLayer = Layer.succeed(ProviderService, {
  get: () => Effect.succeed(undefined),
  getAll: () => Effect.succeed([]),
  getProviderForModel: () => Effect.dieMessage('getProviderForModel is not used'),
  isKnownModel: () => Effect.succeed(true),
})

const TestSettingsLayer = Layer.succeed(SettingsService, {
  get: () => Effect.succeed(DEFAULT_SETTINGS),
  update: () => Effect.void,
  initialize: () => Effect.void,
  flushForTests: () => Effect.void,
})

const TestSessionResourceStoreLayer = Layer.succeed(SessionResourceStore, {
  storeBytes: () => Effect.dieMessage('storeBytes is not used'),
  storeFile: () => Effect.dieMessage('storeFile is not used'),
  inspect: () => Effect.dieMessage('inspect is not used'),
  read: () => Effect.dieMessage('read is not used'),
  remove: () => Effect.dieMessage('remove is not used'),
  removeSession: (sessionId) =>
    Effect.tryPromise({
      try: async () => {
        await removeSessionResourcesMock(sessionId)
      },
      catch: (cause) => new SessionResourceStoreError({ operation: 'removeSession', cause }),
    }),
})

const TestSessionResourceCleanupLayer = Layer.succeed(SessionResourceCleanupRepository, {
  listPending: (limit) => Effect.sync(() => mocks.listPendingSessionResourceCleanupMock(limit)),
  complete: (sessionId) =>
    Effect.sync(() => {
      completeSessionResourceCleanupMock(sessionId)
    }),
})

const TestRuntimeLayer = Layer.mergeAll(
  TestSessionProjectionRepoLayer,
  TestAgentKernelLayer,
  TestSessionRepoLayer,
  TestProviderLayer,
  TestSettingsLayer,
  TestSessionResourceStoreLayer,
  TestSessionResourceCleanupLayer,
  EmptyExtensionRuntimeLayer,
)

export function getInvokeHandler(name: string) {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }

  return (...args: unknown[]) =>
    Effect.runPromise(Effect.provide(handler(...args), TestRuntimeLayer))
}

export function resetSessionDetailsHandlerMocks() {
  for (const mock of Object.values(mocks)) mock.mockReset()
  createRuntimeSessionMock.mockResolvedValue({
    piSessionId: 'pi-session-created',
    piSessionFile: '/tmp/pi-session-created.jsonl',
  })
  listPinnedSessionsMock.mockResolvedValue([])
  pinSessionMock.mockResolvedValue(undefined)
  unpinSessionMock.mockResolvedValue(undefined)
  movePinnedSessionMock.mockResolvedValue(undefined)
  cancelSessionRunsMock.mockReturnValue(false)
  removeSessionResourcesMock.mockReturnValue(undefined)
  mocks.listPendingSessionResourceCleanupMock.mockReturnValue([])
}

export function loadSessionDetailsHandlers(): Promise<typeof SessionDetailsHandler> {
  return import('../session-details-handler')
}
