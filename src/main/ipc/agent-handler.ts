/**
 * Agent IPC handlers — transport layer.
 *
 * Responsibilities: abort controller lifecycle, active run tracking,
 * stream buffer management, IPC event emission, cleanup.
 *
 * Business logic (model validation, session fetching, run execution,
 * message persistence, error classification) lives in AgentRunService.
 */
import { randomUUID } from 'node:crypto'
import { decodeUnknownOrThrow } from '@shared/schema'
import { agentSendPayloadSchema } from '@shared/schemas/validation'
import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'
import * as Effect from 'effect/Effect'
import { getPhaseForSession } from '../agent/phase-tracker'
import { cleanupSessionRun } from '../agent/session-cleanup'
import { type AgentRunResult, executeAgentRun } from '../application/agent-run-service'
import { compactAgentSession, getAgentContextUsage } from '../application/agent-session-service'
import { broadcastToWindows } from '../utils/broadcast'
import {
  clearAgentPhase,
  clearStreamBuffer,
  emitRunCompleted,
  emitTransportEvent,
  getStreamBuffer,
  listStreamBuffers,
  startStreamBuffer,
} from '../utils/stream-bridge'
import {
  activeCompactions,
  activeRuns,
  cancelAllSessionRuns,
  cancelSessionRuns,
  hasAnyActiveRun,
} from './active-agent-runs'
import { emitErrorAndFinish } from './run-handler-utils'
import { typedHandle, typedOn } from './typed-ipc'

function clearSessionTransportState(sessionId: SessionId): void {
  clearAgentPhase(sessionId)
  clearStreamBuffer(sessionId)
  cleanupSessionRun(sessionId)
}

function emitCancelledCompletion(sessionId: SessionId): void {
  clearSessionTransportState(sessionId)
  emitRunCompleted(sessionId)
}

function handleRunResult(sessionId: SessionId, result: AgentRunResult): void {
  if (result.assignedTitle) {
    broadcastToWindows('sessions:title-updated', {
      sessionId,
      title: result.assignedTitle,
    })
  }

  if (result.outcome === 'error' && result.transportEmitted) {
    return
  }

  if (
    result.outcome === 'invalid-model' ||
    result.outcome === 'not-found' ||
    result.outcome === 'error'
  ) {
    emitErrorAndFinish(sessionId, result.message, result.code)
  }
}

/**
 * Pi persists runtime progress into its session file as the run proceeds, so
 * graceful shutdown no longer reconstructs partial assistant messages from
 * stream chunks.
 */
export function persistAllActiveRuns() {
  return Effect.void
}

export function registerAgentHandlers(): void {
  typedHandle(
    'agent:send-message',
    (_event, sessionId: SessionId, payload: AgentSendPayload, model: SupportedModelId) =>
      Effect.gen(function* () {
        const validatedPayload = decodeUnknownOrThrow(agentSendPayloadSchema, payload)
        // ─── Transport: cancel existing same-session work, register new ────
        if (cancelSessionRuns(sessionId)) {
          clearSessionTransportState(sessionId)
        }

        const abortController = new AbortController()
        const runId = randomUUID()
        activeRuns.register(sessionId, abortController, {
          model,
        })

        startStreamBuffer(sessionId, model, 'classic')

        function onEventWithUsageCapture(event: AgentTransportEvent) {
          emitTransportEvent(sessionId, event)
        }

        // ─── Application: delegate to service ────────────
        const result = yield* executeAgentRun({
          sessionId,
          runId,
          payload: validatedPayload,
          model,
          signal: abortController.signal,
          onEvent: onEventWithUsageCapture,
        })

        // ─── Transport: respond based on outcome ─────────
        handleRunResult(sessionId, result)

        // ─── Transport: cleanup ──────────────────────────
        if (activeRuns.deleteIfCurrent(sessionId, abortController)) {
          clearAgentPhase(sessionId)
          clearStreamBuffer(sessionId)
          emitRunCompleted(sessionId)
        }
      }),
  )

  typedOn('agent:cancel', (_event, sessionId?: SessionId) =>
    Effect.sync(() => {
      if (sessionId) {
        if (cancelSessionRuns(sessionId)) {
          emitCancelledCompletion(sessionId)
        }
      } else {
        const cancelledSessionIds = cancelAllSessionRuns()
        for (const id of cancelledSessionIds) {
          emitCancelledCompletion(id)
        }
      }
    }),
  )

  typedHandle('agent:get-phase', (_event, sessionId: SessionId) =>
    Effect.sync(() => getPhaseForSession(sessionId)),
  )

  typedHandle('agent:get-background-run', (_event, sessionId: SessionId) =>
    Effect.sync(() => getStreamBuffer(sessionId)),
  )

  typedHandle('agent:list-active-runs', () => Effect.sync(() => listStreamBuffers()))

  typedHandle('agent:get-context-usage', (_event, sessionId: SessionId, model: SupportedModelId) =>
    getAgentContextUsage({ sessionId, model }),
  )

  typedHandle(
    'agent:compact-session',
    (_event, sessionId: SessionId, model: SupportedModelId, customInstructions?: string) =>
      Effect.gen(function* () {
        if (hasAnyActiveRun(sessionId)) {
          return yield* Effect.fail(
            new Error('Wait for the current run to finish before compacting.'),
          )
        }

        const abortController = new AbortController()
        activeCompactions.register(sessionId, abortController, { model })
        let delayedSuccessfulCompactionEnd: AgentTransportEvent | null = null

        return yield* compactAgentSession({
          sessionId,
          model,
          customInstructions,
          signal: abortController.signal,
          onEvent: (event) => {
            if (event.type === 'compaction_end' && !event.aborted && !event.errorMessage) {
              delayedSuccessfulCompactionEnd = event
              return
            }
            emitTransportEvent(sessionId, event)
          },
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (delayedSuccessfulCompactionEnd) {
                emitTransportEvent(sessionId, delayedSuccessfulCompactionEnd)
              }
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              activeCompactions.deleteIfCurrent(sessionId, abortController)
            }),
          ),
        )
      }),
  )

  typedHandle('agent:steer', (_event, sessionId: SessionId) =>
    Effect.sync(() => {
      if (cancelSessionRuns(sessionId)) {
        emitCancelledCompletion(sessionId)
      }

      return { preserved: false }
    }),
  )
}
