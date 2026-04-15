/**
 * SQLite adapter for the PinnedContextRepository port.
 *
 * Uses dynamic import to defer module-level side effects (same pattern
 * as SqliteConversationRepositoryLive).
 */
import { Effect, Layer } from 'effect'
import {
  PinnedContextRepository,
  type PinnedContextRepositoryShape,
} from '../ports/pinned-context-repository'

export const SqlitePinnedContextRepositoryLive = Effect.promise(async () => {
  const store = await import('../store/pinned-context')

  return Layer.succeed(
    PinnedContextRepository,
    PinnedContextRepository.of({
      list: (conversationId) =>
        Effect.tryPromise({
          try: () => store.listPinnedItems(conversationId),
          catch: (cause) => new Error(`Failed to list pinned items: ${String(cause)}`),
        }),

      add: (conversationId, item) =>
        Effect.tryPromise({
          try: () => store.addPinnedItem(conversationId, item),
          catch: (cause) => new Error(`Failed to add pinned item: ${String(cause)}`),
        }),

      remove: (conversationId, pinId) =>
        Effect.tryPromise({
          try: () => store.removePinnedItem(conversationId, pinId),
          catch: (cause) => new Error(`Failed to remove pinned item: ${String(cause)}`),
        }),

      removeByMessageId: (conversationId, messageId) =>
        Effect.tryPromise({
          try: () => store.removePinnedItemByMessageId(conversationId, messageId),
          catch: (cause) => new Error(`Failed to remove pinned item by message: ${String(cause)}`),
        }),

      getTokenEstimate: (conversationId) =>
        Effect.tryPromise({
          try: () => store.getPinnedTokenEstimate(conversationId),
          catch: (cause) => new Error(`Failed to get pinned token estimate: ${String(cause)}`),
        }),
    } satisfies PinnedContextRepositoryShape),
  )
}).pipe(Layer.unwrapEffect)
