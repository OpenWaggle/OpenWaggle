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
import { matchBy } from '@diegogbrisa/ts-match'
import { decodeUnknownOrThrow } from '@shared/schema'
import {
  agentLoopResponseInputSchema,
  toAgentLoopResponseInput,
} from '@shared/schemas/agent-loop-interaction'
import { agentSendPayloadSchema, toAgentSendPayload } from '@shared/schemas/validation'
import type { AgentSendPayload, AgentSendReport } from '@shared/types/agent'
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
import { type AgentRunResult, executeAgentRun } from '../application/agent-run-service'
import { compactAgentSession, getAgentContextUsage } from '../application/agent-session-service'
import { findWaggleHandoffRequest } from '../application/waggle-handoff'
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
  activeWaggleRuns,
  cancelAllSessionRuns,
  cancelSessionRuns,
  hasAnyActiveRun,
} from './active-agent-runs'
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
 * A send that produced no turn was not delivered, whatever the transport did afterwards.
 *
 * `aborted` is reported as its own outcome rather than as a failure. A run cancelled before its prompt was sent
 * reports the same thing as one cancelled mid-turn, so it is evidence in neither direction - and raising it as
 * an error dismantled the ordinary Stop flow, where a queued follow-up send begins the moment the stopped run
 * settles and the superseded send's reply arrives afterwards.
 */
function describeSendOutcome(result: AgentRunResult): AgentSendReport {
  return (
    matchBy(result, 'outcome')
      .with('success', () => ({ outcome: 'delivered' as const }))
      .with('aborted', () => ({ outcome: 'cancelled' as const }))
      /*
       * A run that reached the transport had the message: `transportEmitted` marks a failure raised *after* the
       * turn began, such as a provider error or a rate limit, as opposed to a refusal raised before it. Reporting
       * both as refusals made a caller restore a review the agent already held and offer it for a second
       * submission - and it drove the renderer to guess at delivery from stream events, which cannot tell one
       * send from the next in the same session. Main knows; it now says so.
       */
      .with('error', (value) =>
        value.transportEmitted === true
          ? { outcome: 'delivered' as const }
          : {
              outcome: 'refused' as const,
              ...(value.message === undefined ? {} : { message: value.message }),
              ...(value.code === undefined ? {} : { code: value.code }),
            },
      )
      .otherwise((value) => ({
        outcome: 'refused' as const,
        ...(value.message === undefined ? {} : { message: value.message }),
        ...(value.code === undefined ? {} : { code: value.code }),
      }))
  )
}

function handleRunResult(sessionId: SessionId, result: AgentRunResult) {
  if (result.outcome === 'error' && result.transportEmitted) {
    return
  }

  matchBy(result, 'outcome')
    .with('success', 'aborted', () => undefined)
    .with('invalid-model', 'not-found', 'error', (value) =>
      emitErrorAndFinish(sessionId, value.message, value.code),
    )
    .exhaustive()
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
        activeRuns.register(sessionId, abortController, {
          model,
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
}

function registerAgentSteeringHandlers() {
  typedHandle('agent:steer', (_event, sessionId: SessionId) =>
    Effect.sync(() => {
      if (cancelSessionRuns(sessionId)) {
        emitCancelledCompletion(sessionId)
      }

      return { preserved: false }
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
