import { Effect, Layer } from 'effect'
import { SessionProjectionRepositoryError } from '../errors'
import { SessionRepository, type SessionRepositoryShape } from '../ports/session-repository'

export const SqliteSessionRepositoryLive = Effect.promise(async () => {
  const store = await import('../store/sessions')
  const sessionConversationStore = await import('../store/session-conversations')
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
              sessionConversationStore.persistSessionSnapshot(input),
            ),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'persistSessionSnapshot', cause }),
        }),
      updateRuntime: (input) =>
        Effect.tryPromise({
          try: () => sessionConversationStore.updateSessionRuntime(input),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'updateSessionRuntime', cause }),
        }),
    } satisfies SessionRepositoryShape),
  )
}).pipe(Layer.unwrapEffect)
