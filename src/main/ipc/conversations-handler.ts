import type { ConversationId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { cleanupConversationRun } from '../agent/conversation-cleanup'
import { ConversationRepository } from '../ports/conversation-repository'
import { typedHandle } from './typed-ipc'

export function registerConversationsHandlers(): void {
  typedHandle('conversations:list', (_event, limit?: number) =>
    Effect.gen(function* () {
      const repo = yield* ConversationRepository
      const results = yield* repo.list(limit)
      return [...results]
    }),
  )

  typedHandle('conversations:list-full', (_event, limit?: number) =>
    Effect.gen(function* () {
      const repo = yield* ConversationRepository
      const results = yield* repo.listFull(limit)
      return [...results]
    }),
  )

  typedHandle('conversations:get', (_event, id: ConversationId) =>
    Effect.gen(function* () {
      const repo = yield* ConversationRepository
      return yield* repo.get(id)
    }),
  )

  typedHandle('conversations:create', (_event, projectPath: string | null) =>
    Effect.gen(function* () {
      const repo = yield* ConversationRepository
      return yield* repo.create(projectPath)
    }),
  )

  typedHandle('conversations:delete', (_event, id: ConversationId) =>
    Effect.sync(() => cleanupConversationRun(id)).pipe(
      Effect.zipRight(
        Effect.gen(function* () {
          const repo = yield* ConversationRepository
          yield* repo.delete(id)
        }),
      ),
    ),
  )

  typedHandle('conversations:archive', (_event, id: ConversationId) =>
    Effect.sync(() => cleanupConversationRun(id)).pipe(
      Effect.zipRight(
        Effect.gen(function* () {
          const repo = yield* ConversationRepository
          yield* repo.archive(id)
        }),
      ),
    ),
  )

  typedHandle('conversations:unarchive', (_event, id: ConversationId) =>
    Effect.gen(function* () {
      const repo = yield* ConversationRepository
      yield* repo.unarchive(id)
    }),
  )

  typedHandle('conversations:list-archived', () =>
    Effect.gen(function* () {
      const repo = yield* ConversationRepository
      const results = yield* repo.listArchived()
      return [...results]
    }),
  )

  typedHandle('conversations:update-title', (_event, id: ConversationId, title: string) =>
    Effect.gen(function* () {
      const repo = yield* ConversationRepository
      yield* repo.updateTitle(id, title)
    }),
  )

  typedHandle(
    'conversations:update-project-path',
    (_event, id: ConversationId, projectPath: string | null) =>
      Effect.gen(function* () {
        const repo = yield* ConversationRepository
        yield* repo.updateProjectPath(id, projectPath)
        return yield* repo.get(id)
      }),
  )

  typedHandle(
    'conversations:update-plan-mode',
    (_event, id: ConversationId, planModeActive: boolean) =>
      Effect.gen(function* () {
        const repo = yield* ConversationRepository
        yield* repo.updatePlanMode(id, planModeActive)
        return yield* repo.get(id)
      }),
  )
}
