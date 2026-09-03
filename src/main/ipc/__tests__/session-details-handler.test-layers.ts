import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { EmptyExtensionRuntimeLayer } from '../../application/__tests__/extension-runtime-test-layer'
import { NoopTerminalServiceLayer } from '../../application/__tests__/terminal-service-test-layer'
import { SessionProjectionRepositoryError } from '../../errors'
import { AgentKernelService } from '../../ports/agent-kernel-service'
import { InlineVisualizationService } from '../../ports/inline-visualization-service'
import { ProviderService } from '../../ports/provider-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'
import type { TerminalService } from '../../ports/terminal-service'
import { SettingsService } from '../../services/settings-service'
import {
  archiveSessionMock,
  createRuntimeSessionMock,
  createSessionMock,
  deleteSessionMock,
  deleteVisualizationSessionMock,
  forkRuntimeSessionMock,
  getSessionDetailMock,
  listArchivedSessionsMock,
  listPinnedSessionsMock,
  listSessionDetailsMock,
  movePinnedSessionMock,
  persistSnapshotMock,
  pinSessionMock,
  rollbackVisualizationSessionDeletionMock,
  setAuthorizationModeMock,
  typedHandleMock,
  unarchiveSessionMock,
  unpinSessionMock,
  updateSessionTitleMock,
} from './session-details-handler.test-harness'
import { SESSION_DETAILS_HANDLER_SOURCE_TREE } from './session-details-handler-tree-fixture'

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
  getTree: () => Effect.succeed(SESSION_DETAILS_HANDLER_SOURCE_TREE),
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

const TestInlineVisualizationLayer = Layer.succeed(
  InlineVisualizationService,
  InlineVisualizationService.of({
    prepareSession: () => Effect.succeed('/visualizations/session'),
    deleteSession: (sessionId) => Effect.sync(() => deleteVisualizationSessionMock(sessionId)),
    stageSessionDeletion: (sessionId) =>
      Effect.succeed({
        commit: Effect.sync(() => deleteVisualizationSessionMock(sessionId)),
        rollback: Effect.sync(() => rollbackVisualizationSessionDeletionMock(sessionId)),
      }),
    readSource: () => Effect.succeed({ status: 'unavailable', reason: 'missing' }),
  }),
)

const TestRuntimeLayer = Layer.mergeAll(
  TestSessionProjectionRepoLayer,
  TestAgentKernelLayer,
  TestSessionRepoLayer,
  TestProviderLayer,
  TestSettingsLayer,
  TestInlineVisualizationLayer,
  EmptyExtensionRuntimeLayer,
  NoopTerminalServiceLayer,
)

/**
 * Layers merged after the base runtime win the service merge, so callers can
 * override one service (e.g. a recording TerminalService) for a single test.
 */
export function getInvokeHandler(
  name: string,
  overrideLayers: ReadonlyArray<Layer.Layer<TerminalService, never, never>> = [],
) {
  const runtimeLayer =
    overrideLayers.length === 0
      ? TestRuntimeLayer
      : Layer.mergeAll(TestRuntimeLayer, ...overrideLayers)
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }

  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), runtimeLayer))
}
