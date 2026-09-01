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
import {
  agentLoopResponseInputSchema,
  toAgentLoopResponseInput,
} from '@shared/schemas/agent-loop-interaction'
import { agentSendPayloadSchema, toAgentSendPayload } from '@shared/schemas/validation'
import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'
import * as Effect from 'effect/Effect'
import { classifyAgentError } from '../agent/error-classifier'
import { getPhaseForSession } from '../agent/phase-tracker'
import { cleanupSessionRun } from '../agent/session-cleanup'
import {
  cancelAgentLoopInteractionsForRun,
  submitAgentLoopInteractionResponse,
} from '../application/agent-loop-interaction-broker'
import { hydrateAgentRunPayload } from '../application/agent-run/kernel'
import { executeAgentRun } from '../application/agent-run-service'
import { compactAgentSession, getAgentContextUsage } from '../application/agent-session-service'
import { findWaggleHandoffRequest } from '../application/waggle-handoff'
import type { AgentKernelRunControl } from '../ports/agent-kernel-service'
import { broadcastToWindows } from '../utils/broadcast'
import {
  clearAgentPhase,
  clearStreamBuffer,
  emitRunCompleted,
  emitTransportEvent,
  emitWorktreeLaunchFailure,
  emitWorktreeLaunchProgress,
  getStreamBuffer,
  listStreamBuffers,
  startStreamBuffer,
} from '../utils/stream-bridge'
import {
  activeCompactions,
  activeRuns,
  activeWaggleRuns,
  cancelAllSessionRuns,
  cancelSessionRuns,
  hasAnyActiveRun,
} from './active-agent-runs'
import { describeSendOutcome, handleRunResult } from './agent-run-result'
import { runAgentRequestedWaggle } from './agent-waggle-handoff'
import { emitErrorAndFinish } from './run-handler-utils'
import { typedHandle } from './typed-ipc'

function clearSessionTransportState(sessionId: SessionId) {
  clearAgentPhase(sessionId)
  clearStreamBuffer(sessionId)
  cleanupSessionRun(sessionId)
}

function emitCancelledCompletion(sessionId: SessionId) {
  clearSessionTransportState(sessionId)
  emitRunCompleted(sessionId)
}

/**
 * Pi persists runtime progress into its session file as the run proceeds, so
 * graceful shutdown no longer reconstructs partial assistant messages from
 * stream chunks.
 */
export function persistAllActiveRuns() {
  return Effect.void
}

function registerAgentRunHandlers() {
  typedHandle(
    'agent:send-message',
    (_event, sessionId: SessionId, payload: AgentSendPayload, model: SupportedModelId) =>
      Effect.gen(function* () {
        const validatedPayload = toAgentSendPayload(
          decodeUnknownOrThrow(agentSendPayloadSchema, payload),
        )
        // ─── Transport: cancel existing same-session work, register new ────
        if (cancelSessionRuns(sessionId)) {
          clearSessionTransportState(sessionId)
        }

        const abortController = new AbortController()
        const runId = randomUUID()
        const controlRef: { current: AgentKernelRunControl | null } = { current: null }
        activeRuns.register(sessionId, abortController, {
          model,
          controlRef,
        })

        startStreamBuffer(sessionId, model, 'classic')

        function onEventWithUsageCapture(event: AgentTransportEvent) {
          emitTransportEvent(sessionId, event)
        }

        // The report is the handler's own result: `Effect.ensuring` runs cleanup without discarding it.
        return yield* Effect.gen(function* () {
          // ─── Application: delegate to service ────────────
          const result = yield* executeAgentRun({
            sessionId,
            runId,
            payload: validatedPayload,
            model,
            signal: abortController.signal,
            onEvent: onEventWithUsageCapture,
            onControlAvailable: (control) => {
              if (activeRuns.isCurrent(sessionId, abortController)) {
                controlRef.current = control
              }
            },
            onWorktreeLaunch: (progress) => emitWorktreeLaunchProgress(sessionId, progress),
            onTitleAssigned: (title) => {
              broadcastToWindows('sessions:title-updated', { sessionId, title })
            },
          })

          const handoff =
            result.outcome === 'success' ? findWaggleHandoffRequest(result.newMessages) : null
          if (handoff && !abortController.signal.aborted) {
            activeWaggleRuns.register(sessionId, abortController, {})
            yield* runAgentRequestedWaggle({
              sessionId,
              handoff,
              model,
              thinkingLevel: validatedPayload.thinkingLevel,
              abortController,
            }).pipe(
              Effect.tapError((error) =>
                Effect.sync(() => {
                  const classified = classifyAgentError(error)
                  emitErrorAndFinish(
                    sessionId,
                    classified.userMessage,
                    classified.code,
                    `waggle-${sessionId}`,
                  )
                }),
              ),
            )
          }

          // ─── Transport: respond based on outcome ─────────
          if (result.outcome === 'error' || result.outcome === 'invalid-model') {
            emitWorktreeLaunchFailure(sessionId, result.message)
          }
          handleRunResult(sessionId, result)
          /*
           * Reported back, because main recovers every run failure into a value rather than failing the Effect:
           * without this the invoke resolved identically whether the turn ran or was refused, and a caller with
           * work to protect - a submitted review - cleared it on a failure that looked like success.
           */
          return describeSendOutcome(result)
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              // ─── Transport: cleanup ──────────────────────
              cancelAgentLoopInteractionsForRun({ sessionId, runId })
              activeWaggleRuns.deleteIfCurrent(sessionId, abortController)
              if (activeRuns.deleteIfCurrent(sessionId, abortController)) {
                clearAgentPhase(sessionId)
                clearStreamBuffer(sessionId)
                emitRunCompleted(sessionId)
              }
            }),
          ),
        )
      }),
  )

  typedHandle('agent:cancel', (_event, sessionId?: SessionId) =>
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
}

function registerAgentInteractionHandlers() {
  typedHandle('agent:respond-interaction', (_event, input) =>
    Effect.sync(() => {
      const decoded = decodeUnknownOrThrow(agentLoopResponseInputSchema, input)
      return submitAgentLoopInteractionResponse(toAgentLoopResponseInput(decoded))
    }),
  )
}

function registerAgentStateHandlers() {
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
}

function registerAgentCompactionHandlers() {
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
        let delayedSuccessfulCompactionEnd: Extract<
          AgentTransportEvent,
          { type: 'compaction_end' }
        > | null = null

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
          Effect.tapError((error) =>
            Effect.sync(() => {
              if (!delayedSuccessfulCompactionEnd) return
              emitTransportEvent(sessionId, {
                ...delayedSuccessfulCompactionEnd,
                aborted: true,
                willRetry: false,
                errorMessage: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
              })
              delayedSuccessfulCompactionEnd = null
            }),
          ),
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
}

function registerAgentSteeringHandlers() {
  typedHandle('agent:steer', (_event, sessionId: SessionId, payload: AgentSendPayload) =>
    Effect.gen(function* () {
      const validatedPayload = toAgentSendPayload(
        decodeUnknownOrThrow(agentSendPayloadSchema, payload),
      )
      const control = activeRuns.get(sessionId)?.metadata.controlRef?.current
      if (!control) {
        return yield* Effect.fail(new Error('The active agent run is not ready for steering.'))
      }
      const hydratedPayload = yield* hydrateAgentRunPayload(validatedPayload)
      yield* Effect.promise(() => control.steer(hydratedPayload))
      return { preserved: true }
    }),
  )
}

export function registerAgentHandlers(): void {
  registerAgentRunHandlers()
  registerAgentInteractionHandlers()
  registerAgentStateHandlers()
  registerAgentCompactionHandlers()
  registerAgentSteeringHandlers()
}

/** Exposed for tests: the reporting rule decides whether a caller keeps a submitted review. */
export const describeSendOutcomeForTests = describeSendOutcome
