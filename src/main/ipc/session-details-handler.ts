import { isAgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId, SessionNodeId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { PinnedSessionMove, SessionWorktreePlan } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { resolveEffectiveAuthorizationMode } from '../application/agent-authorization-mode'
import { grantPendingAuthorizationsForSession } from '../application/agent-loop-interaction-broker'
import { dismissInterruptedAgentRun } from '../application/agent-run-service'
import {
  cloneAgentSessionToNewSession,
  forkAgentSessionToNewSession,
} from '../application/agent-session-service'
import { AgentKernelService } from '../ports/agent-kernel-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SettingsService } from '../services/settings-service'
import { validateRequiredProjectPath } from './project-path-validation'
import { archiveSessionWithFences, deleteSessionWithFences } from './session-removal'
import { typedHandle } from './typed-ipc'

/** `null` is valid and means "clear the override so this session inherits again". */
function validateAuthorizationMode(mode: unknown) {
  if (mode === null || isAgentAuthorizationMode(mode)) return Effect.succeed(mode)
  return Effect.fail(new Error('Session authorization mode is invalid.'))
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

  typedHandle('sessions:get-hive-relations', (_event, id: SessionId) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      return yield* repo.getHiveRelations(id)
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

/**
 * Pinned session handlers (issue #97).
 *
 * Pins are read as one list rather than per session: the Pinned section renders in
 * Manual order, so the renderer needs the order, not a per-session boolean.
 */
function registerSessionPinHandlers() {
  typedHandle('sessions:pins:list', () =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      return [...(yield* repo.listPinnedSessions())]
    }),
  )

  typedHandle('sessions:pins:pin', (_event, id: SessionId) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      yield* repo.pinSession(id)
    }),
  )

  typedHandle('sessions:pins:unpin', (_event, id: SessionId) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      yield* repo.unpinSession(id)
    }),
  )

  typedHandle('sessions:pins:move', (_event, move: PinnedSessionMove) =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      yield* repo.movePinnedSession(move)
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
      const repo = yield* SessionProjectionRepository
      return yield* repo.create({
        projectPath: normalizedProjectPath,
        piSessionId: runtimeSession.piSessionId,
        piSessionFile: runtimeSession.piSessionFile,
        environmentMode: settings.defaultSessionEnvironmentMode,
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
  typedHandle('sessions:delete', (_event, id: SessionId) => deleteSessionWithFences(id))
  typedHandle('sessions:archive', (_event, id: SessionId) => archiveSessionWithFences(id))

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

      // Switching to full access must also clear the question already on screen, otherwise the
      // run stays parked on a prompt in a mode that promises never to prompt. Resolved rather
      // than read from the argument, so clearing an override that reveals a YOLO default counts.
      const effective = yield* Effect.promise(() => resolveEffectiveAuthorizationMode(id))
      if (effective === 'yolo') {
        yield* Effect.sync(() => grantPendingAuthorizationsForSession({ sessionId: id }))
      }
    }),
  )
}

export function registerSessionDetailsHandlers(): void {
  registerSessionDetailsReadHandlers()
  registerSessionPinHandlers()
  registerSessionCreationHandlers()
  registerSessionMutationHandlers()
}
