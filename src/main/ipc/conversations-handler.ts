import type { ConversationId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { cleanupConversationRun } from '../agent/conversation-cleanup'
import { AgentKernelService } from '../ports/agent-kernel-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { validateRequiredProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

export function registerConversationsHandlers(): void {
  typedHandle('conversations:list', (_event, limit?: number) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      const results = yield* repo.list(limit)
      return [...results]
    }),
  )

  typedHandle('conversations:list-full', (_event, limit?: number) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      const results = yield* repo.listFull(limit)
      return [...results]
    }),
  )

  typedHandle('conversations:get', (_event, id: ConversationId) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      return yield* repo.getOptional(id)
    }),
  )

  typedHandle('conversations:create', (_event, projectPath: string) =>
    Effect.gen(function* () {
      const normalizedProjectPath = yield* validateRequiredProjectPath(projectPath)
      const agentKernel = yield* AgentKernelService
      const runtimeSession = yield* agentKernel.createSession({
        projectPath: normalizedProjectPath,
      })
      const repo = yield* SessionProjectionRepository
      return yield* repo.create({
        projectPath: normalizedProjectPath,
        piSessionId: runtimeSession.piSessionId,
        piSessionFile: runtimeSession.piSessionFile,
      })
    }),
  )

  typedHandle('conversations:delete', (_event, id: ConversationId) =>
    Effect.sync(() => cleanupConversationRun(id)).pipe(
      Effect.zipRight(
        Effect.gen(function* () {
          const repo = yield* SessionProjectionRepository
          yield* repo.delete(id)
        }),
      ),
    ),
  )

  typedHandle('conversations:archive', (_event, id: ConversationId) =>
    Effect.sync(() => cleanupConversationRun(id)).pipe(
      Effect.zipRight(
        Effect.gen(function* () {
          const repo = yield* SessionProjectionRepository
          yield* repo.archive(id)
        }),
      ),
    ),
  )

  typedHandle('conversations:unarchive', (_event, id: ConversationId) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      yield* repo.unarchive(id)
    }),
  )

  typedHandle('conversations:list-archived', () =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      const results = yield* repo.listArchived()
      return [...results]
    }),
  )

  typedHandle('conversations:update-title', (_event, id: ConversationId, title: string) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      yield* repo.updateTitle(id, title)
    }),
  )
}
