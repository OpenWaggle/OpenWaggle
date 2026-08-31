import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SessionHostEventDelivery } from '@shared/types/session-host-event'
import type {
  SessionQueryRequest,
  SessionQueryResponse,
  SessionWaitState,
} from '@shared/types/session-query'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  SessionQueryRepository,
  type SessionQueryRepositoryShape,
} from '../ports/session-query-repository'
import { SessionWaitService } from '../ports/session-wait-service'
import { getSessionHostEventRuntime } from '../session-host/session-host-events'
import { waitForSessionExport } from './session-export-wait'

type WaitRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { readonly operation: 'wait' }>
}

function response(
  request: SessionQueryRequest,
  outcome: SessionQueryResponse['outcome'],
): SessionQueryResponse {
  return { contractVersion: SESSION_QUERY_CONTRACT_VERSION, requestId: request.requestId, outcome }
}

async function readStates(
  repository: SessionQueryRepositoryShape,
  input: {
    readonly authority?: LocalSessionProfileAuthority
    readonly resolveObservationAuthority?: () => Promise<LocalSessionProfileAuthority | undefined>
    readonly signal?: AbortSignal
  },
  request: WaitRequest,
) {
  throwIfAborted(input.signal)
  const authority = input.resolveObservationAuthority
    ? await input.resolveObservationAuthority()
    : input.authority
  const states: SessionWaitState[] = []
  for (const target of request.query.targets) {
    throwIfAborted(input.signal)
    const result = await Effect.runPromise(
      repository.execute({
        ...(authority ? { authority } : {}),
        request: {
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: `${request.requestId}:${target.sessionId}`,
          query: { operation: 'status', sessionId: target.sessionId },
        },
      }),
    )
    if (result.outcome.operation !== 'status' || 'error' in result.outcome) return null
    states.push(result.outcome)
  }
  return states
}

function matchingSessionIds(request: WaitRequest, states: readonly SessionWaitState[]) {
  const byId = new Map(states.map((state) => [state.sessionId, state]))
  return request.query.targets.flatMap((target) => {
    const state = byId.get(target.sessionId)
    if (!state) return []
    const matched =
      target.condition === 'idle'
        ? state.activeRunId === null
        : target.condition === 'queue-empty'
          ? state.pendingFollowUpCount === 0
          : target.afterStateRevision !== undefined &&
            state.stateRevision > target.afterStateRevision
    return matched ? [target.sessionId] : []
  })
}

function nextWithTimeout(
  subscription: { readonly next: () => Promise<SessionHostEventDelivery> },
  timeoutMs: number,
  signal?: AbortSignal,
) {
  return new Promise<SessionHostEventDelivery | { readonly status: 'timeout' }>(
    (resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(signal))
        return
      }
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        callback()
      }
      const onAbort = () => finish(() => reject(abortError(signal)))
      const timer = setTimeout(() => finish(() => resolve({ status: 'timeout' })), timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      subscription.next().then(
        (delivery) => finish(() => resolve(delivery)),
        (error) => finish(() => reject(error)),
      )
    },
  )
}

function abortError(signal?: AbortSignal) {
  return signal?.reason instanceof Error ? signal.reason : new Error('aborted')
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal)
}

function isTargetDelivery(request: WaitRequest, delivery: SessionHostEventDelivery) {
  if (delivery.status !== 'event') return false
  const payload = delivery.event.payload
  if (payload.kind === 'semantic-discovery-readiness-changed') return false
  return request.query.targets.some((target) => target.sessionId === payload.sessionId)
}

function targetEventFilter(request: WaitRequest) {
  const targetSessionIds = new Set(request.query.targets.map((target) => target.sessionId))
  return (event: Extract<SessionHostEventDelivery, { readonly status: 'event' }>['event']) =>
    event.payload.kind !== 'semantic-discovery-readiness-changed' &&
    targetSessionIds.has(event.payload.sessionId)
}

function closeWaitSubscription(
  subscription:
    | ReturnType<ReturnType<typeof getSessionHostEventRuntime>['eventHub']['subscribeAfter']>
    | undefined,
) {
  if (subscription?.status === 'ready') subscription.subscription.close()
}

async function wait(
  repository: SessionQueryRepositoryShape,
  input: {
    readonly authority?: LocalSessionProfileAuthority
    readonly resolveObservationAuthority?: () => Promise<LocalSessionProfileAuthority | undefined>
    readonly signal?: AbortSignal
    readonly request: WaitRequest
  },
): Promise<SessionQueryResponse> {
  const runtime = getSessionHostEventRuntime()
  const releaseLiveness = runtime.liveness.acquire('wait')
  const snapshotCursor = runtime.eventHub.cursor()
  let subscription: ReturnType<typeof runtime.eventHub.subscribeAfter> | undefined
  try {
    let states = await readStates(repository, input, input.request)
    if (!states) {
      return response(input.request, {
        operation: 'wait',
        error: {
          code: 'session_not_found',
          message: 'One or more target Sessions were not found.',
        },
      })
    }
    let matchedSessionIds = matchingSessionIds(input.request, states)
    if (matchedSessionIds.length > 0 || input.request.query.timeoutMs === 0) {
      return response(input.request, {
        operation: 'wait',
        timedOut: matchedSessionIds.length === 0,
        matchedSessionIds,
        cursor: runtime.eventHub.cursor(),
        states,
      })
    }
    subscription = runtime.eventHub.subscribeAfter(
      input.request.query.after ?? snapshotCursor,
      targetEventFilter(input.request),
    )
    if (subscription.status === 'resync-required') {
      return response(input.request, {
        operation: 'wait',
        error: {
          code: 'resync_required',
          message: `Session event resynchronization is required: ${subscription.reason}.`,
        },
      })
    }
    const deadline = Date.now() + input.request.query.timeoutMs
    while (true) {
      const remaining = Math.max(0, deadline - Date.now())
      const delivery = await nextWithTimeout(subscription.subscription, remaining, input.signal)
      if (delivery.status === 'timeout') {
        const observedStates = await readStates(repository, input, input.request)
        if (!observedStates) {
          return response(input.request, {
            operation: 'wait',
            error: {
              code: 'session_not_found',
              message: 'One or more target Sessions were not found.',
            },
          })
        }
        states = observedStates
        matchedSessionIds = matchingSessionIds(input.request, states)
        return response(input.request, {
          operation: 'wait',
          timedOut: matchedSessionIds.length === 0,
          matchedSessionIds,
          cursor: runtime.eventHub.cursor(),
          states,
        })
      }
      if (delivery.status === 'resync-required') {
        return response(input.request, {
          operation: 'wait',
          error: {
            code: 'resync_required',
            message: `Session event resynchronization is required: ${delivery.reason}.`,
          },
        })
      }
      if (delivery.status === 'closed') {
        return response(input.request, {
          operation: 'wait',
          error: { code: 'host_stopped', message: 'The Session Host stopped while waiting.' },
        })
      }
      if (!isTargetDelivery(input.request, delivery)) continue
      const observedStates = await readStates(repository, input, input.request)
      if (!observedStates) {
        return response(input.request, {
          operation: 'wait',
          error: {
            code: 'session_not_found',
            message: 'One or more target Sessions were not found.',
          },
        })
      }
      states = observedStates
      matchedSessionIds = matchingSessionIds(input.request, states)
      if (matchedSessionIds.length > 0) {
        return response(input.request, {
          operation: 'wait',
          timedOut: false,
          matchedSessionIds,
          cursor: runtime.eventHub.cursor(),
          states,
        })
      }
    }
  } finally {
    closeWaitSubscription(subscription)
    releaseLiveness()
  }
}

export const SessionWaitServiceLive = Layer.effect(
  SessionWaitService,
  Effect.gen(function* () {
    const repository = yield* SessionQueryRepository
    return SessionWaitService.of({
      wait: (input) =>
        Effect.tryPromise({
          try: () => wait(repository, input),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }),
      waitForExport: (input) =>
        Effect.tryPromise({
          try: () => waitForSessionExport(repository, input),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }),
    })
  }),
)
