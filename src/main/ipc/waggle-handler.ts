import { matchBy } from '@diegogbrisa/ts-match'
import { decodeUnknownOrThrow } from '@shared/schema'
import { agentSendPayloadSchema } from '@shared/schemas/validation'
import type { AgentSendPayload, Message } from '@shared/types/agent'
import type { SessionId, SupportedModelId } from '@shared/types/brand'
import type { WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { classifyAgentError } from '../agent/error-classifier'
import { executeWaggleRun } from '../application/waggle-run-service'
import { broadcastToWindows } from '../utils/broadcast'
import {
  clearAgentPhase,
  clearStreamBuffer,
  emitRunCompleted,
  emitTransportEvent,
  emitWaggleTransportEvent,
  emitWaggleTurnEvent,
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
      if (activeWaggleRuns.cancel(sessionId)) finishWaggleRun(sessionId)
    }),
  )
}

function handleSendWaggleMessage(
  sessionId: SessionId,
  payload: AgentSendPayload,
  model: SupportedModelId,
  config: WaggleConfig,
) {
  return Effect.gen(function* () {
    const validatedPayload = decodeUnknownOrThrow(agentSendPayloadSchema, payload)
    cancelExistingWaggleWork(sessionId)

    const abortController = new AbortController()
    const runId = `waggle-${sessionId}`
    activeWaggleRuns.register(sessionId, abortController, {})

    yield* Effect.ensuring(
      runRegisteredWaggleMessage(
        sessionId,
        runId,
        validatedPayload,
        model,
        config,
        abortController,
      ),
      Effect.sync(() => {
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
      onTitleAssigned: (title) =>
        broadcastToWindows('sessions:title-updated', { sessionId, title }),
    })

    handleWaggleResult(sessionId, runId, result)
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

function handleWaggleResult(sessionId: SessionId, runId: string, result: WaggleHandlerResult) {
  matchBy(result, 'outcome')
    .with('validation-error', (value) =>
      emitErrorAndFinish(sessionId, value.message, value.code, runId),
    )
    .with('not-found', (value) => emitErrorAndFinish(sessionId, value.message, value.code, runId))
    .with('no-project', (value) => emitErrorAndFinish(sessionId, value.message, value.code, runId))
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
