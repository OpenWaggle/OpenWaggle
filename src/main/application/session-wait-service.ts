import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import {
  isSessionlessHostEvent,
  type SessionHostEventEnvelope,
} from '@shared/types/session-host-event'
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
import {
  SessionReportRepository,
  type SessionReportRepositoryShape,
} from '../ports/session-report-repository'
import { SessionWaitService } from '../ports/session-wait-service'
import { getSessionHostEventRuntime } from '../session-host/session-host-events'
import { waitForSessionExport } from './session-export-wait'
import { throwIfAborted, waitForSessionHostCondition } from './session-host-condition-wait'
import { acquireWaitLiveness } from './session-host-run-admission'

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
  reports: SessionReportRepositoryShape,
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
    const reportObservation =
      target.condition === 'report-delivered' || target.condition === 'correlated-reply'
        ? await Effect.runPromise(reports.observeWaitCondition({ target }))
        : undefined
    states.push({ ...result.outcome, ...(reportObservation ? { reportObservation } : {}) })
  }
  return states
}

function matchingSessionIds(request: WaitRequest, states: readonly SessionWaitState[]) {
  return request.query.targets.flatMap((target, index) => {
    const state = states[index]
    if (!state) return []
    const matched =
      target.condition === 'idle'
        ? state.activeRunId === null
        : target.condition === 'queue-empty'
          ? state.pendingFollowUpCount === 0
          : target.condition === 'state-revision-after'
            ? state.stateRevision > target.afterStateRevision
            : target.condition === 'report-delivered'
              ? state.reportObservation?.condition === 'report-delivered' &&
                state.reportObservation.deliveryStatus === 'delivered'
              : state.reportObservation?.condition === 'correlated-reply' &&
                state.reportObservation.replyReportId !== undefined
    return matched ? [target.sessionId] : []
  })
}

function targetEventFilter(request: WaitRequest) {
  const targetSessionIds = new Set(request.query.targets.map((target) => target.sessionId))
  return (event: SessionHostEventEnvelope) =>
    !isSessionlessHostEvent(event.payload) && targetSessionIds.has(event.payload.sessionId)
}

function waitResponse(request: WaitRequest, states: readonly SessionWaitState[]) {
  const matchedSessionIds = matchingSessionIds(request, states)
  return response(request, {
    operation: 'wait',
    timedOut: matchedSessionIds.length === 0,
    matchedSessionIds,
    cursor: getSessionHostEventRuntime().eventHub.cursor(),
    states,
  })
}

function sessionNotFound(request: WaitRequest) {
  return response(request, {
    operation: 'wait',
    error: {
      code: 'session_not_found',
      message: 'One or more target Sessions were not found.',
    },
  })
}

async function wait(
  repository: SessionQueryRepositoryShape,
  reports: SessionReportRepositoryShape,
  input: {
    readonly authority?: LocalSessionProfileAuthority
    readonly resolveObservationAuthority?: () => Promise<LocalSessionProfileAuthority | undefined>
    readonly signal?: AbortSignal
    readonly request: WaitRequest
  },
): Promise<SessionQueryResponse> {
  const runtime = getSessionHostEventRuntime()
  const releaseLiveness = acquireWaitLiveness(runtime.liveness)
  const snapshotCursor = runtime.eventHub.cursor()
  try {
    const states = await readStates(repository, reports, input, input.request)
    if (!states) return sessionNotFound(input.request)
    if (
      matchingSessionIds(input.request, states).length > 0 ||
      input.request.query.timeoutMs === 0
    ) {
      return waitResponse(input.request, states)
    }
    const observation = await waitForSessionHostCondition({
      eventHub: runtime.eventHub,
      after: input.request.query.after ?? snapshotCursor,
      accepts: targetEventFilter(input.request),
      read: () => readStates(repository, reports, input, input.request),
      matches: (observed) => matchingSessionIds(input.request, observed).length > 0,
      deadline: Date.now() + input.request.query.timeoutMs,
      ...(input.signal ? { signal: input.signal } : {}),
    })
    if (observation.status === 'missing') return sessionNotFound(input.request)
    if (observation.status === 'host-stopped') {
      return response(input.request, {
        operation: 'wait',
        error: { code: 'host_stopped', message: 'The Session Host stopped while waiting.' },
      })
    }
    return waitResponse(input.request, observation.value)
  } finally {
    releaseLiveness()
  }
}

export const SessionWaitServiceLive = Layer.effect(
  SessionWaitService,
  Effect.gen(function* () {
    const repository = yield* SessionQueryRepository
    const reports = yield* SessionReportRepository
    return SessionWaitService.of({
      wait: (input) =>
        Effect.tryPromise({
          try: () => wait(repository, reports, input),
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
