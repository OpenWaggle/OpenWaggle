/**
 * SQLite adapter for the SessionProjectionRepository port.
 *
 * Wraps the current session-backed UI projection store in Effect
 * values and provides a Layer that satisfies the SessionProjectionRepository tag.
 * Follows the same dynamic-import pattern as SettingsService.Live to defer
 * module-level side effects until runtime initialization.
 */
import { Effect, Layer } from 'effect'
import { SessionProjectionRepositoryError } from '../errors'
import {
  SessionProjectionRepository,
  type SessionProjectionRepositoryShape,
} from '../ports/session-projection-repository'

export const SqliteSessionProjectionRepositoryLive = Effect.promise(async () => {
  const store = await import('../store/session-conversations')

  return Layer.succeed(
    SessionProjectionRepository,
    SessionProjectionRepository.of({
      get: (id) =>
        Effect.tryPromise({
          try: () => store.getConversation(id),
          catch: (cause) => new SessionProjectionRepositoryError({ operation: 'get', cause }),
        }).pipe(
          Effect.flatMap((conversation) =>
            conversation
              ? Effect.succeed(conversation)
              : Effect.fail(
                  new SessionProjectionRepositoryError({
                    operation: 'get',
                    cause: `Session projection ${id} not found`,
                  }),
                ),
          ),
        ),

      getOptional: (id) =>
        Effect.tryPromise({
          try: () => store.getConversation(id),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'getOptional', cause }),
        }),

      list: (limit) =>
        Effect.tryPromise({
          try: () => store.listConversations(limit),
          catch: (cause) => new SessionProjectionRepositoryError({ operation: 'list', cause }),
        }),

      listFull: (limit) =>
        Effect.tryPromise({
          try: () => store.listFullConversations(limit),
          catch: (cause) => new SessionProjectionRepositoryError({ operation: 'listFull', cause }),
        }),

      create: (input) =>
        Effect.tryPromise({
          try: () => store.createConversation(input),
          catch: (cause) => new SessionProjectionRepositoryError({ operation: 'create', cause }),
        }),

      delete: (id) =>
        Effect.tryPromise({
          try: () => store.deleteConversation(id),
          catch: (cause) => new SessionProjectionRepositoryError({ operation: 'delete', cause }),
        }),

      archive: (id) =>
        Effect.tryPromise({
          try: () => store.archiveConversation(id),
          catch: (cause) => new SessionProjectionRepositoryError({ operation: 'archive', cause }),
        }),

      unarchive: (id) =>
        Effect.tryPromise({
          try: () => store.unarchiveConversation(id),
          catch: (cause) => new SessionProjectionRepositoryError({ operation: 'unarchive', cause }),
        }),

      listArchived: () =>
        Effect.tryPromise({
          try: () => store.listArchivedConversations(),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'listArchived', cause }),
        }),

      updateTitle: (id, title) =>
        Effect.tryPromise({
          try: () => store.updateConversationTitle(id, title),
          catch: (cause) =>
            new SessionProjectionRepositoryError({ operation: 'updateTitle', cause }),
        }),
    } satisfies SessionProjectionRepositoryShape),
  )
}).pipe(Layer.unwrapEffect)
