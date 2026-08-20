import {
  type AgentAuthorizationMode,
  isAgentAuthorizationMode,
} from '@shared/types/agent-authorization'
import type { SessionId, SessionNodeId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionWorktreePlan } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { cleanupSessionRun } from '../agent/session-cleanup'
import { dismissInterruptedAgentRun } from '../application/agent-run-service'
import {
  cloneAgentSessionToNewSession,
  forkAgentSessionToNewSession,
} from '../application/agent-session-service'
import { getProjectPreferences } from '../config/project-config'
import { AgentKernelService } from '../ports/agent-kernel-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SettingsService } from '../services/settings-service'
import { clearAgentPhase, clearStreamBuffer, emitRunCompleted } from '../utils/stream-bridge'
import { cancelSessionRuns } from './active-agent-runs'
import { validateRequiredProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

function cleanupBeforeSessionRemoval(sessionId: SessionId) {
  const cancelledActiveRun = cancelSessionRuns(sessionId)
  clearAgentPhase(sessionId)
  clearStreamBuffer(sessionId)
  cleanupSessionRun(sessionId)
  if (cancelledActiveRun) {
    emitRunCompleted(sessionId)
  }
}

function validateAuthorizationMode(mode: unknown) {
  if (!isAgentAuthorizationMode(mode)) {
    return Effect.fail(new Error('Session authorization mode is invalid.'))
  }
  return Effect.succeed(mode)
}

function resolveSessionAuthorizationMode(input: {
  readonly projectPath: string
  readonly globalDefault: AgentAuthorizationMode
}) {
  return Effect.promise(() => getProjectPreferences(input.projectPath)).pipe(
    Effect.map((preferences) => preferences?.authorizationMode ?? input.globalDefault),
  )
}

function registerSessionDetailsReadHandlers() {
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

  typedHandle('sessions:turn-checkpoints:list', (_event, id: SessionId) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      return [...(yield* repo.listTurnCheckpoints(id))]
    }),
  )

  typedHandle('sessions:turn-diff:get', (_event, id: SessionId, turnId: string) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      return yield* repo.getTurnDiff(id, turnId)
    }),
  )
}

function registerSessionCreationHandlers() {
  typedHandle('sessions:create', (_event, projectPath: string) =>
    Effect.gen(function* () {
      const normalizedProjectPath = yield* validateRequiredProjectPath(projectPath)
      const agentKernel = yield* AgentKernelService
      const runtimeSession = yield* agentKernel.createSession({
        projectPath: normalizedProjectPath,
      })
      const settings = yield* (yield* SettingsService).get()
      const authorizationMode = yield* resolveSessionAuthorizationMode({
        projectPath: normalizedProjectPath,
        globalDefault: settings.defaultAuthorizationMode,
      })
      const repo = yield* SessionProjectionRepository
      return yield* repo.create({
        projectPath: normalizedProjectPath,
        piSessionId: runtimeSession.piSessionId,
        piSessionFile: runtimeSession.piSessionFile,
        environmentMode: settings.defaultSessionEnvironmentMode,
        authorizationMode,
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
}

function registerSessionMutationHandlers() {
  typedHandle('sessions:delete', (_event, id: SessionId) =>
    Effect.sync(() => cleanupBeforeSessionRemoval(id)).pipe(
      Effect.zipRight(
        Effect.gen(function* () {
          const repo = yield* SessionProjectionRepository
          yield* repo.delete(id)
        }),
      ),
    ),
  )

  typedHandle('sessions:archive', (_event, id: SessionId) =>
    Effect.sync(() => cleanupBeforeSessionRemoval(id)).pipe(
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

  typedHandle('sessions:set-worktree-plan', (_event, id: SessionId, plan: SessionWorktreePlan) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      yield* repo.setWorktreePlan(id, plan)
    }),
  )

  typedHandle('sessions:set-authorization-mode', (_event, id: SessionId, mode: unknown) =>
    Effect.gen(function* () {
      const validatedMode = yield* validateAuthorizationMode(mode)
      const repo = yield* SessionProjectionRepository
      yield* repo.setAuthorizationMode(id, validatedMode)
    }),
  )
}

export function registerSessionDetailsHandlers(): void {
  registerSessionDetailsReadHandlers()
  registerSessionCreationHandlers()
  registerSessionMutationHandlers()
}
