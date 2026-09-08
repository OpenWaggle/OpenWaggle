import { isAgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId, SessionNodeId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { PinnedSessionMove, SessionWorktreePlan } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { cleanupSessionRun } from '../agent/session-cleanup'
import { resolveEffectiveAuthorizationMode } from '../application/agent-authorization-mode'
import { grantPendingAuthorizationsForSession } from '../application/agent-loop-interaction-broker'
import { dismissInterruptedAgentRun } from '../application/agent-run-service'
import {
  cloneAgentSessionToNewSession,
  forkAgentSessionToNewSession,
} from '../application/agent-session-service'
import { createLogger } from '../logger'
import { AgentKernelService } from '../ports/agent-kernel-service'
import { InlineVisualizationService } from '../ports/inline-visualization-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { TerminalService } from '../ports/terminal-service'
import { SettingsService } from '../services/settings-service'
import { clearAgentPhase, clearStreamBuffer, emitRunCompleted } from '../utils/stream-bridge'
import {
  acquireSessionRemovalFence,
  cancelSessionRuns,
  waitForSessionRuns,
} from './active-agent-runs'
import { validateRequiredProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

const logger = createLogger('session-details-handler')
const SESSION_REMOVAL_SETTLE_TIMEOUT_MS = 30_000

function cleanupBeforeSessionRemoval(sessionId: SessionId) {
  const cancelledActiveRun = cancelSessionRuns(sessionId)
  clearAgentPhase(sessionId)
  clearStreamBuffer(sessionId)
  cleanupSessionRun(sessionId)
  if (cancelledActiveRun) {
    emitRunCompleted(sessionId)
  }
}

function quiesceBeforeSessionRemoval(sessionId: SessionId) {
  return Effect.sync(() => cleanupBeforeSessionRemoval(sessionId)).pipe(
    Effect.zipRight(
      Effect.tryPromise({
        try: () => waitForSessionRuns(sessionId, SESSION_REMOVAL_SETTLE_TIMEOUT_MS),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
    ),
    Effect.flatMap((settled) =>
      settled
        ? Effect.void
        : Effect.fail(
            new Error(
              `Session work did not stop within ${String(SESSION_REMOVAL_SETTLE_TIMEOUT_MS)} ms. The session was left unchanged.`,
            ),
          ),
    ),
  )
}

function withSessionRemovalFence<A, E, R>(sessionId: SessionId, operation: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const terminals = yield* TerminalService
    return yield* terminals.runWithMutationFence(
      { kind: 'owner', ownerKey: String(sessionId) },
      Effect.acquireUseRelease(
        Effect.try({
          try: () => acquireSessionRemovalFence(sessionId),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
        () => operation,
        (release) => Effect.sync(release),
      ),
    )
  })
}

/** Deleted sessions take their terminals and scrollback with them (ADR 0030). */
function cleanupTerminalsForDeletedSession(sessionId: SessionId, deleteHistory: boolean) {
  return Effect.gen(function* () {
    const terminals = yield* TerminalService
    yield* terminals.closeAllForOwner(String(sessionId), deleteHistory)
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        logger.warn('Terminal cleanup for session deletion failed', {
          sessionId: String(sessionId),
          error: String(error),
        })
      }),
    ),
  )
}

/** Archived sessions stop hidden processes but retain scrollback for restoration. */
function cleanupTerminalsForArchivedSession(sessionId: SessionId) {
  return Effect.gen(function* () {
    const terminals = yield* TerminalService
    yield* terminals.closeAllForOwner(String(sessionId), false)
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        logger.warn('Terminal cleanup before session archive failed', {
          sessionId: String(sessionId),
          error: String(error),
        })
      }),
    ),
  )
}

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
  typedHandle('sessions:delete', (_event, id: SessionId) =>
    withSessionRemovalFence(
      id,
      quiesceBeforeSessionRemoval(id).pipe(
        Effect.zipRight(cleanupTerminalsForDeletedSession(id, false)),
        Effect.zipRight(
          Effect.gen(function* () {
            const visualizations = yield* InlineVisualizationService
            const stagedDeletion = yield* visualizations.stageSessionDeletion(id)
            const repo = yield* SessionProjectionRepository
            yield* repo.delete(id).pipe(Effect.tapError(() => stagedDeletion.rollback))
            yield* stagedDeletion.commit.pipe(
              Effect.catchAll((error) => {
                logger.warn('Deferred visualization tombstone cleanup after session deletion', {
                  sessionId: String(id),
                  error: String(error),
                })
                return Effect.void
              }),
            )
            // The durable Session is gone, so delete the retained/cold terminal
            // history in a second pass. A repository refusal never reaches here.
            yield* cleanupTerminalsForDeletedSession(id, true).pipe(
              Effect.catchAll((error) => {
                logger.warn('Deferred terminal history cleanup after session deletion', {
                  sessionId: String(id),
                  error: String(error),
                })
                return Effect.void
              }),
            )
          }),
        ),
      ),
    ),
  )

  typedHandle('sessions:archive', (_event, id: SessionId) =>
    withSessionRemovalFence(
      id,
      quiesceBeforeSessionRemoval(id).pipe(
        Effect.zipRight(cleanupTerminalsForArchivedSession(id)),
        Effect.zipRight(
          Effect.gen(function* () {
            const repo = yield* SessionProjectionRepository
            yield* repo.archive(id)
          }),
        ),
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
