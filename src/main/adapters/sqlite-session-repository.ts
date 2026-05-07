import { Effect, Layer } from 'effect'
import { SessionProjectionRepositoryError } from '../errors'
import { SessionRepository, type SessionRepositoryShape } from '../ports/session-repository'

export const SqliteSessionRepositoryLive = Effect.promise(async () => {
  const store = await import('../store/sessions')
  const sessionDetailStore = await import('../store/session-details')
  const { withSessionLock } = await import('../store/session-lock')

  return Layer.succeed(
    SessionRepository,
    SessionRepository.of({
      list: (limit) =>
        Effect.tryPromise({
          try: () => store.listSessions(limit),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'listSessions', cause }),
        }),
      listArchivedBranches: (limit) =>
        Effect.tryPromise({
          try: () => store.listArchivedSessionBranches(limit),
          catch: (cause) =>
            new SessionProjectionRepositoryError({
              operation: 'listArchivedSessionBranches',
              cause,
            }),
        }),
      getTree: (sessionId) =>
        Effect.tryPromise({
          try: () => store.getSessionTree(sessionId),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'getSessionTree', cause }),
        }),
      getWorkspace: (sessionId, selection) =>
        Effect.tryPromise({
          try: () => store.getSessionWorkspace(sessionId, selection),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'getSessionWorkspace', cause }),
        }),
      persistSnapshot: (input) =>
        Effect.tryPromise({
          try: () =>
            withSessionLock(input.sessionId, () =>
              sessionDetailStore.persistSessionSnapshot(input),
            ),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'persistSessionSnapshot', cause }),
        }),
      updateRuntime: (input) =>
        Effect.tryPromise({
          try: () => sessionDetailStore.updateSessionRuntime(input),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'updateSessionRuntime', cause }),
        }),
      renameBranch: (sessionId, branchId, name) =>
        Effect.tryPromise({
          try: () => store.renameSessionBranch(sessionId, branchId, name),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'renameSessionBranch', cause }),
        }),
      archiveBranch: (sessionId, branchId) =>
        Effect.tryPromise({
          try: () => store.archiveSessionBranch(sessionId, branchId),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'archiveSessionBranch', cause }),
        }),
      restoreBranch: (sessionId, branchId) =>
        Effect.tryPromise({
          try: () => store.restoreSessionBranch(sessionId, branchId),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'restoreSessionBranch', cause }),
        }),
      updateTreeUiState: (sessionId, patch) =>
        Effect.tryPromise({
          try: () => store.updateSessionTreeUiState(sessionId, patch),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'updateSessionTreeUiState', cause }),
        }),
      recordActiveRun: (input) =>
        Effect.tryPromise({
          try: () => store.recordSessionActiveRun(input),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'recordSessionActiveRun', cause }),
        }),
      clearActiveRun: (input) =>
        Effect.tryPromise({
          try: () => store.clearSessionActiveRun(input),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'clearSessionActiveRun', cause }),
        }),
      clearInterruptedRuns: (input) =>
        Effect.tryPromise({
          try: () => store.clearInterruptedSessionRuns(input),
          catch: (cause) =>
            new SessionProjectionRepositoryError({
              operation: 'clearInterruptedSessionRuns',
              cause,
            }),
        }),
      listActiveRunsForRecovery: () =>
        Effect.tryPromise({
          try: () => store.listSessionActiveRunsForRecovery(),
          catch: (cause) =>
            new SessionProjectionRepositoryError({
              operation: 'listSessionActiveRunsForRecovery',
              cause,
            }),
        }),
      markActiveRunInterrupted: (input) =>
        Effect.tryPromise({
          try: () => store.markSessionActiveRunInterrupted(input),
          catch: (cause) =>
            new SessionProjectionRepositoryError({
              operation: 'markSessionActiveRunInterrupted',
              cause,
            }),
        }),
    } satisfies SessionRepositoryShape),
  )
}).pipe(Layer.unwrapEffect)
