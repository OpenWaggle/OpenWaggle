import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import type { AgentTransportEvent } from '@shared/types/stream'
import * as Effect from 'effect/Effect'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import {
  cancelCompactionSessionRun,
  hasAnyActiveRun,
  reserveCompactionSessionWriter,
} from './active-session-runs'
import { compactAgentSession } from './agent-session-service'

type LocalCompactionPayload = Extract<
  LocalSessionCommandPayload,
  { contract: 'local-compaction-v1' }
>
type LocalCompactionCancelPayload = Extract<
  LocalSessionCommandPayload,
  { contract: 'local-compaction-cancel-v1' }
>

export function authorizeManualSessionCompactionCaller(caller: LocalSessionCallerIdentity) {
  return caller.callerId === 'gui:local-user' && caller.profileAuthority === undefined
    ? Effect.void
    : Effect.fail(new Error('Manual compaction requires the authenticated local GUI caller.'))
}

function publishCompactionEvent(sessionId: SessionId, event: AgentTransportEvent) {
  publishSessionHostEvent({ kind: 'session-transport', sessionId, event })
}

export function executeManualSessionCompaction(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: LocalCompactionPayload
  readonly signal?: AbortSignal
}) {
  return authorizeManualSessionCompactionCaller(input.caller).pipe(
    Effect.zipRight(runManualSessionCompaction(input)),
  )
}

export function executeManualSessionCompactionCancellation(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: LocalCompactionCancelPayload
}) {
  return Effect.gen(function* () {
    yield* authorizeManualSessionCompactionCaller(input.caller)
    const request = input.payload.request
    return {
      contract: 'local-compaction-cancel-v1' as const,
      response: {
        requestId: request.requestId,
        sessionId: request.sessionId,
        cancelled: cancelCompactionSessionRun(SessionId(request.sessionId)),
      },
    }
  })
}

function runManualSessionCompaction(input: {
  readonly payload: LocalCompactionPayload
  readonly signal?: AbortSignal
}) {
  const request = input.payload.request
  const sessionId = SessionId(request.sessionId)
  return Effect.gen(function* () {
    if (hasAnyActiveRun(sessionId)) {
      return yield* Effect.fail(new Error('Wait for the current run to finish before compacting.'))
    }
    const abortController = new AbortController()
    const abort = () => abortController.abort()
    const writer = yield* Effect.try(() =>
      reserveCompactionSessionWriter(sessionId, abortController, SupportedModelId(request.model)),
    )
    input.signal?.addEventListener('abort', abort, { once: true })
    if (input.signal?.aborted) abort()
    let delayedSuccessfulEnd: AgentTransportEvent | null = null
    const compact = compactAgentSession({
      sessionId,
      model: SupportedModelId(request.model),
      ...(request.customInstructions !== undefined
        ? { customInstructions: request.customInstructions }
        : {}),
      signal: abortController.signal,
      onEvent: (event) => {
        if (event.type === 'compaction_end' && !event.aborted && !event.errorMessage) {
          delayedSuccessfulEnd = event
          return
        }
        publishCompactionEvent(sessionId, event)
      },
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          if (delayedSuccessfulEnd) publishCompactionEvent(sessionId, delayedSuccessfulEnd)
        }),
      ),
      Effect.map((result) => ({
        contract: 'local-compaction-v1' as const,
        response: { requestId: request.requestId, sessionId: request.sessionId, result },
      })),
    )
    return yield* compact.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          input.signal?.removeEventListener('abort', abort)
          writer.release()
        }),
      ),
    )
  })
}
