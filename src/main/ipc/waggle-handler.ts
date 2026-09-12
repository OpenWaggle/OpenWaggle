import { randomUUID } from 'node:crypto'
import { decodeUnknownOrThrow } from '@shared/schema'
import { agentSendPayloadSchema, toAgentSendPayload } from '@shared/schemas/validation'
import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId, SupportedModelId } from '@shared/types/brand'
import {
  type LocalSessionCommandPayload,
  SESSION_WAGGLE_CONTRACT_VERSION,
} from '@shared/types/local-session-protocol'
import type { WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { dispatchLocalSessionCommand } from '../application/local-session-command-dispatcher'
import { typedHandle, typedOn } from './typed-ipc'

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
  typedOn('agent:cancel-waggle', (_event, sessionId: SessionId) => cancelWaggle(sessionId))
}

function cancelWaggle(sessionId: SessionId) {
  return Effect.gen(function* () {
    const command = explicitWaggleCancellationPayload(sessionId)
    const result = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user' },
      payload: command,
    })
    if (
      result.contract !== 'session-waggle-cancel-v1' ||
      result.response.requestId !== command.request.requestId ||
      result.response.sessionId !== command.request.sessionId
    ) {
      return yield* Effect.fail(
        new Error('Session Host returned an invalid Waggle cancellation response.'),
      )
    }
  })
}

function explicitWaggleCancellationPayload(
  sessionId: SessionId,
): Extract<LocalSessionCommandPayload, { contract: 'session-waggle-cancel-v1' }> {
  return {
    contract: 'session-waggle-cancel-v1',
    request: {
      contractVersion: SESSION_WAGGLE_CONTRACT_VERSION,
      requestId: randomUUID(),
      sessionId,
    },
  }
}

function explicitWagglePayload(
  sessionId: SessionId,
  payload: AgentSendPayload,
  model: SupportedModelId,
  config: WaggleConfig,
): Extract<LocalSessionCommandPayload, { contract: 'session-waggle-v1' }> {
  const validatedPayload = toAgentSendPayload(decodeUnknownOrThrow(agentSendPayloadSchema, payload))
  return {
    contract: 'session-waggle-v1',
    request: {
      contractVersion: SESSION_WAGGLE_CONTRACT_VERSION,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      sessionId,
      payload: { ...validatedPayload, attachments: [...validatedPayload.attachments] },
      model,
      config,
    },
  }
}

function handleSendWaggleMessage(
  sessionId: SessionId,
  payload: AgentSendPayload,
  model: SupportedModelId,
  config: WaggleConfig,
) {
  return Effect.gen(function* () {
    const command = explicitWagglePayload(sessionId, payload, model, config)
    const result = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user' },
      payload: command,
    })
    if (
      result.contract !== 'session-waggle-v1' ||
      result.response.requestId !== command.request.requestId ||
      result.response.idempotencyKey !== command.request.idempotencyKey
    ) {
      return yield* Effect.fail(new Error('Session Host returned an invalid Waggle response.'))
    }
    return result.response.report
  })
}
