import type { SessionId, SessionNodeId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import * as Effect from 'effect/Effect'
import { cleanupSessionRun } from '../agent/session-cleanup'
import { dismissInterruptedAgentRun } from '../application/agent-run-service'
import {
  cloneAgentSessionToNewSession,
  forkAgentSessionToNewSession,
} from '../application/agent-session-service'
import { AgentKernelService } from '../ports/agent-kernel-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { validateRequiredProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

export function registerSessionDetailsHandlers(): void {
  typedHandle('sessions:list-details', (_event, limit?: number) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      const results = yield* repo.listDetails(limit)
      return [...results]
    }),
  )

  typedHandle('sessions:get-detail', (_event, id: SessionId) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      return yield* repo.getOptional(id)
    }),
  )

  typedHandle('sessions:create', (_event, projectPath: string) =>
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

  typedHandle(
    'sessions:fork-to-new',
    (_event, sessionId: SessionId, model: SupportedModelId, targetNodeId: SessionNodeId) =>
      forkAgentSessionToNewSession({ sessionId, model, targetNodeId }),
  )

  typedHandle(
    'sessions:clone-to-new',
    (_event, sessionId: SessionId, model: SupportedModelId, targetNodeId: SessionNodeId) =>
      cloneAgentSessionToNewSession({ sessionId, model, targetNodeId }),
  )

  typedHandle('sessions:dismiss-interrupted-run', (_event, sessionId: SessionId, runId: string) =>
    dismissInterruptedAgentRun({ sessionId, runId }),
  )

  typedHandle('sessions:delete', (_event, id: SessionId) =>
    Effect.sync(() => cleanupSessionRun(id)).pipe(
      Effect.zipRight(
        Effect.gen(function* () {
          const repo = yield* SessionProjectionRepository
          yield* repo.delete(id)
        }),
      ),
    ),
  )

  typedHandle('sessions:archive', (_event, id: SessionId) =>
    Effect.sync(() => cleanupSessionRun(id)).pipe(
      Effect.zipRight(
        Effect.gen(function* () {
          const repo = yield* SessionProjectionRepository
          yield* repo.archive(id)
        }),
      ),
    ),
  )

  typedHandle('sessions:unarchive', (_event, id: SessionId) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      yield* repo.unarchive(id)
    }),
  )

  typedHandle('sessions:list-archived', () =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      const results = yield* repo.listArchived()
      return [...results]
    }),
  )

  typedHandle('sessions:update-title', (_event, id: SessionId, title: string) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      yield* repo.updateTitle(id, title)
    }),
  )
}
