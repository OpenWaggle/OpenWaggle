import { randomUUID } from 'node:crypto'
import { isAgentAuthorizationMode } from '@shared/types/agent-authorization'
import { SessionId, type SessionNodeId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { PinnedSessionMove, SessionWorktreePlan } from '@shared/types/session'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { SESSION_LIFECYCLE_CONTRACT_VERSION } from '@shared/types/session-lifecycle'
import type { SessionOrganizationCommand } from '@shared/types/session-organization'
import * as Effect from 'effect/Effect'
import { cleanupSessionRun } from '../agent/session-cleanup'
import { dispatchLocalSessionCommand } from '../application/local-session-command-dispatcher'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SettingsService } from '../services/settings-service'
import { clearAgentPhase, clearStreamBuffer, emitRunCompleted } from '../utils/stream-bridge'
import { validateRequiredProjectPath } from './project-path-validation'
import { mutateLocalUiSession } from './session-host-ui-mutation'
import { typedHandle } from './typed-ipc'

function cleanupAfterSessionRemoval(sessionId: SessionId) {
  clearAgentPhase(sessionId)
  clearStreamBuffer(sessionId)
  cleanupSessionRun(sessionId)
  emitRunCompleted(sessionId)
}

/** `null` is valid and means "clear the override so this session inherits again". */
function validateAuthorizationMode(mode: unknown) {
  if (mode === null) return Effect.succeed(null)
  if (!isAgentAuthorizationMode(mode)) {
    return Effect.fail(new Error('Session authorization mode is invalid.'))
  }
  return Effect.succeed(mode)
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
    mutateLocalUiSession({ operation: 'pin', sessionId: id }),
  )

  typedHandle('sessions:pins:unpin', (_event, id: SessionId) =>
    mutateLocalUiSession({ operation: 'unpin', sessionId: id }),
  )

  typedHandle('sessions:pins:move', (_event, move: PinnedSessionMove) =>
    mutateLocalUiSession({
      operation: 'move-pin',
      sessionId: move.sessionId,
      afterSessionId: move.afterSessionId,
      beforeSessionId: move.beforeSessionId,
    }),
  )
}

function registerSessionCreationHandlers() {
  typedHandle(
    'sessions:create',
    (_event, projectPath: string, worktreePlan?: SessionWorktreePlan) =>
      Effect.gen(function* () {
        const normalizedProjectPath = yield* validateRequiredProjectPath(projectPath)
        const settings = yield* (yield* SettingsService).get()
        const environmentMode =
          worktreePlan?.environmentMode ?? settings.defaultSessionEnvironmentMode
        const result = yield* dispatchLocalSessionCommand({
          caller: { callerId: 'gui:local-user', workingDirectory: normalizedProjectPath },
          payload: {
            contract: 'session-lifecycle-v2',
            request: {
              contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
              requestId: randomUUID(),
              idempotencyKey: randomUUID(),
              command: {
                operation: 'create',
                projectPath: normalizedProjectPath,
                workspace:
                  environmentMode === 'worktree'
                    ? {
                        mode: 'new-worktree',
                        ...(worktreePlan?.baseRef ? { baseRef: worktreePlan.baseRef } : {}),
                        ...(worktreePlan?.startFromOrigin !== undefined
                          ? { startFromOrigin: worktreePlan.startFromOrigin }
                          : {}),
                      }
                    : { mode: 'local' },
              },
            },
          },
        })
        if (
          result.contract !== 'session-lifecycle-v2' ||
          result.response.outcome.effect !== 'created-root'
        ) {
          return yield* Effect.fail(new Error('Session Host rejected GUI Session creation.'))
        }
        const repo = yield* SessionProjectionRepository
        const session = yield* repo.getOptional(SessionId(result.response.outcome.sessionId))
        return session ?? (yield* Effect.fail(new Error('Created Session projection is missing.')))
      }),
  )

  typedHandle(
    'sessions:fork-to-new',
    (_event, sessionId: SessionId, _model: SupportedModelId, targetNodeId: SessionNodeId) =>
      forkSessionThroughHost(sessionId, targetNodeId, 'before'),
  )

  typedHandle(
    'sessions:clone-to-new',
    (_event, sessionId: SessionId, _model: SupportedModelId, targetNodeId: SessionNodeId) =>
      forkSessionThroughHost(sessionId, targetNodeId, 'at'),
  )

  typedHandle('sessions:dismiss-interrupted-run', (_event, sessionId: SessionId, runId: string) =>
    mutateLocalUiSession({ operation: 'dismiss-interrupted-run', sessionId, runId }).pipe(
      Effect.asVoid,
    ),
  )
}

function forkSessionThroughHost(
  sourceSessionId: SessionId,
  targetNodeId: SessionNodeId,
  position: 'before' | 'at',
) {
  return Effect.gen(function* () {
    const result = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
      payload: {
        contract: 'session-lifecycle-v2',
        request: {
          contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
          requestId: randomUUID(),
          idempotencyKey: randomUUID(),
          command: {
            operation: 'fork',
            sourceSessionId: String(sourceSessionId),
            targetNodeId: String(targetNodeId),
            position,
          },
        },
      },
    })
    if (
      result.contract !== 'session-lifecycle-v2' ||
      result.response.outcome.effect !== 'forked-session'
    ) {
      return yield* Effect.fail(new Error('Session Host rejected GUI Session fork.'))
    }
    const repo = yield* SessionProjectionRepository
    const session = yield* repo.getOptional(SessionId(result.response.outcome.sessionId))
    if (!session) return yield* Effect.fail(new Error('Forked Session projection is missing.'))
    return {
      session,
      cancelled: false,
      ...(result.response.outcome.editorText
        ? { editorText: result.response.outcome.editorText }
        : {}),
    }
  })
}

function registerSessionMutationHandlers() {
  typedHandle('sessions:delete', (_event, id: SessionId) =>
    mutateLocalUiSession({ operation: 'delete', sessionId: id }).pipe(
      Effect.tap(() => Effect.sync(() => cleanupAfterSessionRemoval(id))),
      Effect.asVoid,
    ),
  )

  typedHandle('sessions:archive', (_event, id: SessionId) =>
    organizeSessionThroughHost({ operation: 'archive', sessionId: id }, 'session-archived'),
  )

  typedHandle('sessions:unarchive', (_event, id: SessionId) =>
    organizeSessionThroughHost({ operation: 'unarchive', sessionId: id }, 'session-unarchived'),
  )

  typedHandle('sessions:list-archived', () =>
    Effect.gen(function* () {
      const repo = yield* SessionProjectionRepository
      const results = yield* repo.listArchived()
      return [...results]
    }),
  )

  typedHandle('sessions:update-title', (_event, id: SessionId, title: string) =>
    organizeSessionThroughHost({ operation: 'rename', sessionId: id, title }, 'session-renamed'),
  )

  typedHandle('sessions:set-authorization-mode', (_event, id: SessionId, mode: unknown) =>
    Effect.gen(function* () {
      const validatedMode = yield* validateAuthorizationMode(mode)
      const result = yield* dispatchLocalSessionCommand({
        caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
        payload: {
          contract: 'session-control-v2',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: randomUUID(),
            idempotencyKey: randomUUID(),
            command: {
              operation: 'authorization-set',
              sessionId: id,
              authorizationMode: validatedMode,
            },
          },
        },
      })
      if (
        result.contract !== 'session-control-v2' ||
        result.response.outcome.effect !== 'authorization-updated'
      ) {
        return yield* Effect.fail(new Error('Session Host rejected Authorization mode update.'))
      }
    }),
  )
}

function organizeSessionThroughHost(
  command: SessionOrganizationCommand,
  expectedEffect: 'session-renamed' | 'session-archived' | 'session-unarchived',
) {
  return Effect.gen(function* () {
    const result = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
      payload: {
        contract: 'session-control-v2',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: randomUUID(),
          idempotencyKey: randomUUID(),
          command,
        },
      },
    })
    if (
      result.contract !== 'session-control-v2' ||
      result.response.outcome.effect !== expectedEffect
    ) {
      return yield* Effect.fail(new Error('Session Host rejected Session organization.'))
    }
  })
}

export function registerSessionDetailsHandlers(): void {
  registerSessionDetailsReadHandlers()
  registerSessionPinHandlers()
  registerSessionCreationHandlers()
  registerSessionMutationHandlers()
}
