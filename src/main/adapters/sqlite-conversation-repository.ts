/**
 * SQLite adapter for the ConversationRepository port.
 *
 * Wraps the existing `src/main/store/conversations.ts` functions in Effect
 * values and provides a Layer that satisfies the ConversationRepository tag.
 * Follows the same dynamic-import pattern as SettingsService.Live to defer
 * module-level side effects until runtime initialization.
 */
import { Effect, Layer } from 'effect'
import { ConversationRepositoryError } from '../errors'
import {
  ConversationRepository,
  type ConversationRepositoryShape,
} from '../ports/conversation-repository'

export const SqliteConversationRepositoryLive = Effect.promise(async () => {
  const store = await import('../store/conversations')
  const { withConversationLock } = await import('../store/conversation-lock')

  return Layer.succeed(
    ConversationRepository,
    ConversationRepository.of({
      get: (id) =>
        Effect.tryPromise({
          try: () => store.getConversation(id),
          catch: (cause) => new ConversationRepositoryError({ operation: 'get', cause }),
        }).pipe(
          Effect.flatMap((conversation) =>
            conversation
              ? Effect.succeed(conversation)
              : Effect.fail(
                  new ConversationRepositoryError({
                    operation: 'get',
                    cause: `Conversation ${id} not found`,
                  }),
                ),
          ),
        ),

      save: (conversation) =>
        Effect.tryPromise({
          try: () =>
            withConversationLock(conversation.id, () => store.saveConversation(conversation)),
          catch: (cause) => new ConversationRepositoryError({ operation: 'save', cause }),
        }),

      list: (limit) =>
        Effect.tryPromise({
          try: () => store.listConversations(limit),
          catch: (cause) => new ConversationRepositoryError({ operation: 'list', cause }),
        }),

      create: (projectPath) =>
        Effect.tryPromise({
          try: () => store.createConversation(projectPath),
          catch: (cause) => new ConversationRepositoryError({ operation: 'create', cause }),
        }),

      delete: (id) =>
        Effect.tryPromise({
          try: () => store.deleteConversation(id),
          catch: (cause) => new ConversationRepositoryError({ operation: 'delete', cause }),
        }),

      archive: (id) =>
        Effect.tryPromise({
          try: () => store.archiveConversation(id),
          catch: (cause) => new ConversationRepositoryError({ operation: 'archive', cause }),
        }),

      unarchive: (id) =>
        Effect.tryPromise({
          try: () => store.unarchiveConversation(id),
          catch: (cause) => new ConversationRepositoryError({ operation: 'unarchive', cause }),
        }),

      listArchived: () =>
        Effect.tryPromise({
          try: () => store.listArchivedConversations(),
          catch: (cause) => new ConversationRepositoryError({ operation: 'listArchived', cause }),
        }),

      updateTitle: (id, title) =>
        Effect.tryPromise({
          try: () => store.updateConversationTitle(id, title),
          catch: (cause) => new ConversationRepositoryError({ operation: 'updateTitle', cause }),
        }),

      updateProjectPath: (id, projectPath) =>
        Effect.tryPromise({
          try: () => store.updateConversationProjectPath(id, projectPath),
          catch: (cause) =>
            new ConversationRepositoryError({ operation: 'updateProjectPath', cause }),
        }).pipe(Effect.map(() => undefined)),

      updatePlanMode: (id, active) =>
        Effect.tryPromise({
          try: () => store.updateConversationPlanMode(id, active),
          catch: (cause) => new ConversationRepositoryError({ operation: 'updatePlanMode', cause }),
        }).pipe(Effect.map(() => undefined)),

      updateCompactionGuidance: (id, guidance) =>
        Effect.tryPromise({
          try: () => store.updateCompactionGuidance(id, guidance),
          catch: (cause) =>
            new ConversationRepositoryError({ operation: 'updateCompactionGuidance', cause }),
        }),

      markMessagesAsCompacted: (id, messageIds) =>
        Effect.tryPromise({
          try: () => store.markMessagesAsCompacted(id, messageIds),
          catch: (cause) =>
            new ConversationRepositoryError({ operation: 'markMessagesAsCompacted', cause }),
        }),
    } satisfies ConversationRepositoryShape),
  )
}).pipe(Layer.unwrapEffect)
