import { matchBy } from '@diegogbrisa/ts-match'
import { decodeUnknownOrThrow } from '@shared/schema'
import { agentSendPayloadSchema, toAgentSendPayload } from '@shared/schemas/validation'
import type { AgentSendPayload, AgentSendReport, Message } from '@shared/types/agent'
import type { SessionId, SupportedModelId } from '@shared/types/brand'
import type { WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { classifyAgentError } from '../agent/error-classifier'
import { cancelAgentLoopInteractionsForRun } from '../application/agent-loop-interaction-broker'
import { executeWaggleRun } from '../application/waggle-run-service'
import { broadcastToWindows } from '../utils/broadcast'
import {
  clearAgentPhase,
  clearStreamBuffer,
  emitRunCompleted,
  emitTransportEvent,
  emitWaggleTransportEvent,
  emitWaggleTurnEvent,
  emitWorktreeLaunchFailure,
  emitWorktreeLaunchProgress,
  startStreamBuffer,
} from '../utils/stream-bridge'
import { activeWaggleRuns, cancelSessionRuns } from './active-agent-runs'
import { emitErrorAndFinish } from './run-handler-utils'
import { typedHandle, typedOn } from './typed-ipc'

interface WaggleValidationErrorResult {
  readonly outcome: 'validation-error'
  readonly message: string
  readonly code: string
}

interface WaggleNotFoundResult {
  readonly outcome: 'not-found'
  readonly message: string
  readonly code: string
}

interface WaggleNoProjectResult {
  readonly outcome: 'no-project'
  readonly message: string
  readonly code: string
}

interface WaggleAbortedResult {
  readonly outcome: 'aborted'
}

/**
 * A run that failed rather than being refused up front or cancelled.
 *
 * `transportEmitted` marks a failure raised *after* the agent took the turn - a provider error, a rate limit -
 * as opposed to a refusal raised before it. A caller holding work submitted with the message needs the two apart:
 * one means "keep it, it never arrived", the other means "the agent has it, do not offer it again".
 */
interface WaggleErrorResult {
  readonly outcome: 'error'
  readonly message: string
  readonly code: string
  readonly transportEmitted?: boolean
}

interface WaggleSuccessResult {
  readonly outcome: 'success'
  readonly newMessages: readonly Message[]
  readonly lastError?: string
}

type WaggleHandlerResult =
  | WaggleValidationErrorResult
  | WaggleNotFoundResult
  | WaggleNoProjectResult
  | WaggleAbortedResult
  | WaggleErrorResult
  | WaggleSuccessResult

export function registerWaggleHandlers() {
  registerSendWaggleMessageHandler()
  registerCancelWaggleHandler()
}

function registerSendWaggleMessageHandler() {
  typedHandle(
    'agent:send-waggle-message',
    (
      _event,
      sessionId: SessionId,
      payload: AgentSendPayload,
      model: SupportedModelId,
      config: WaggleConfig,
    ) => handleSendWaggleMessage(sessionId, payload, model, config),
  )
}

function registerCancelWaggleHandler() {
  typedOn('agent:cancel-waggle', (_event, sessionId: SessionId) =>
    Effect.sync(() => {
      if (activeWaggleRuns.cancel(sessionId)) {
        cancelAgentLoopInteractionsForRun({ sessionId, runId: waggleRunId(sessionId) })
        finishWaggleRun(sessionId)
      }
    }),
  )
}

function waggleRunId(sessionId: SessionId) {
  return `waggle-${sessionId}`
}

function handleSendWaggleMessage(
  sessionId: SessionId,
  payload: AgentSendPayload,
  model: SupportedModelId,
  config: WaggleConfig,
) {
  return Effect.gen(function* () {
    const validatedPayload = toAgentSendPayload(
      decodeUnknownOrThrow(agentSendPayloadSchema, payload),
    )
    cancelExistingWaggleWork(sessionId)

    const abortController = new AbortController()
    const runId = waggleRunId(sessionId)
    activeWaggleRuns.register(sessionId, abortController, {})

    return yield* Effect.ensuring(
      runRegisteredWaggleMessage(
        sessionId,
        runId,
        validatedPayload,
        model,
        config,
        abortController,
      ),
      Effect.sync(() => {
        cancelAgentLoopInteractionsForRun({ sessionId, runId })
        if (activeWaggleRuns.deleteIfCurrent(sessionId, abortController)) finishWaggleRun(sessionId)
      }),
    )
  })
}

function runRegisteredWaggleMessage(
  sessionId: SessionId,
  runId: string,
  payload: AgentSendPayload,
  model: SupportedModelId,
  config: WaggleConfig,
  abortController: AbortController,
) {
  return Effect.gen(function* () {
    const result = yield* executeWaggleRun({
      sessionId,
      runId,
      payload,
      model,
      config,
      signal: abortController.signal,
      onRunPrepared: (runtimeModel) => startWaggleStream(sessionId, runId, runtimeModel),
      onEvent: (event, meta) => {
        emitWaggleTransportEvent(sessionId, event, meta)
        if (event.type !== 'agent_end') emitTransportEvent(sessionId, event)
      },
      onTurnEvent: (event) => emitWaggleTurnEvent(sessionId, event),
      onWorktreeLaunch: (progress) => emitWorktreeLaunchProgress(sessionId, progress),
      onTitleAssigned: (title) =>
        broadcastToWindows('sessions:title-updated', { sessionId, title }),
    })

    if (result.outcome === 'error') {
      emitWorktreeLaunchFailure(sessionId, result.message)
    }
    handleWaggleResult(sessionId, runId, result)
    /*
     * Reported back for the same reason the classic path does it: this Effect succeeds whether the turn ran or
     * was refused, so a caller with work to protect could not tell the difference.
     */
    return describeWaggleSendOutcome(result)
  })
}

function cancelExistingWaggleWork(sessionId: SessionId) {
  if (!cancelSessionRuns(sessionId)) return
  clearAgentPhase(sessionId)
  clearStreamBuffer(sessionId)
}

function startWaggleStream(sessionId: SessionId, runId: string, runtimeModel: SupportedModelId) {
  startStreamBuffer(sessionId, runtimeModel, 'waggle')
  emitTransportEvent(sessionId, { type: 'agent_start', timestamp: Date.now(), runId })
}

/**
 * A send that produced no turn was not delivered, whatever the transport did afterwards.
 *
 * `aborted` is its own outcome for the same reason it is on the classic path: a cancellation before the prompt
 * was sent reports the same thing as one mid-turn, and raising it as an error broke the Stop flow.
 */
function describeWaggleSendOutcome(result: WaggleHandlerResult): AgentSendReport {
  return (
    matchBy(result, 'outcome')
      .with('success', () => ({ outcome: 'delivered' as const }))
      .with('aborted', () => ({ outcome: 'cancelled' as const }))
      /*
       * A run that reached the agent had the message, so its later failure is not a refusal - the same distinction
       * the classic path draws, and for the same reason: a caller holding a submitted review must not be handed it
       * back after the agent already received it.
       */
      .with('error', (value) =>
        value.transportEmitted === true
          ? { outcome: 'delivered' as const }
          : { outcome: 'refused' as const, message: value.message, code: value.code },
      )
      .otherwise((value) => ({
        outcome: 'refused' as const,
        message: value.message,
        code: value.code,
      }))
  )
}

function handleWaggleResult(sessionId: SessionId, runId: string, result: WaggleHandlerResult) {
  matchBy(result, 'outcome')
    .with('validation-error', (value) =>
      emitErrorAndFinish(sessionId, value.message, value.code, runId),
    )
    .with('not-found', (value) => emitErrorAndFinish(sessionId, value.message, value.code, runId))
    .with('no-project', (value) => emitErrorAndFinish(sessionId, value.message, value.code, runId))
    .with('error', (value) => emitErrorAndFinish(sessionId, value.message, value.code, runId))
    .with('aborted', () => emitWaggleEnd(sessionId, runId, 'aborted'))
    .with('success', (value) => handleWaggleSuccess(sessionId, runId, value))
    .exhaustive()
}

function handleWaggleSuccess(sessionId: SessionId, runId: string, result: WaggleSuccessResult) {
  if (countAssistantMessages(result.newMessages) === 0 && result.lastError) {
    const classified = classifyAgentError(new Error(result.lastError))
    emitErrorAndFinish(sessionId, classified.userMessage, classified.code, runId)
    return
  }
  emitWaggleEnd(sessionId, runId, 'stop')
}

function countAssistantMessages(messages: readonly Message[]) {
  return messages.filter((message) => message.role === 'assistant').length
}

function emitWaggleEnd(sessionId: SessionId, runId: string, reason: 'aborted' | 'stop') {
  emitTransportEvent(sessionId, { type: 'agent_end', timestamp: Date.now(), runId, reason })
}

function finishWaggleRun(sessionId: SessionId) {
  clearAgentPhase(sessionId)
  clearStreamBuffer(sessionId)
  emitRunCompleted(sessionId)
}
