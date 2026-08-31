import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SessionExportOperationSummary } from '@shared/types/session-export-operation'
import type { SessionHostEventDelivery } from '@shared/types/session-host-event'
import type { SessionQueryRequest, SessionQueryResponse } from '@shared/types/session-query'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import type { SessionQueryRepositoryShape } from '../ports/session-query-repository'
import { getSessionHostEventRuntime } from '../session-host/session-host-events'
import type { SessionHostEventSubscription } from './session-host-event-hub'

type ExportWaitRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { readonly operation: 'exports-wait' }>
}

function response(
  request: ExportWaitRequest,
  outcome: SessionQueryResponse['outcome'],
): SessionQueryResponse {
  return { contractVersion: SESSION_QUERY_CONTRACT_VERSION, requestId: request.requestId, outcome }
}

async function readExportOperation(
  repository: SessionQueryRepositoryShape,
  input: {
    readonly authority?: LocalSessionProfileAuthority
    readonly resolveObservationAuthority?: () => Promise<LocalSessionProfileAuthority | undefined>
    readonly signal?: AbortSignal
  },
  request: ExportWaitRequest,
) {
  throwIfAborted(input.signal)
  const authority = input.resolveObservationAuthority
    ? await input.resolveObservationAuthority()
    : input.authority
  const result = await Effect.runPromise(
    repository.execute({
      ...(authority ? { authority } : {}),
      request: {
        contractVersion: SESSION_QUERY_CONTRACT_VERSION,
        requestId: `${request.requestId}:read`,
        query: {
          operation: 'exports-read',
          sessionId: request.query.sessionId,
          exportOperationId: request.query.exportOperationId,
        },
      },
    }),
  )
  return result.outcome.operation === 'exports-read' && 'export' in result.outcome
    ? result.outcome.export
    : null
}

function exportIsTerminal(operation: SessionExportOperationSummary) {
  return (
    operation.status === 'completed' ||
    operation.status === 'failed' ||
    operation.status === 'cancelled'
  )
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

async function waitForTerminalExport(input: {
  readonly repository: SessionQueryRepositoryShape
  readonly authority?: LocalSessionProfileAuthority
  readonly resolveObservationAuthority?: () => Promise<LocalSessionProfileAuthority | undefined>
  readonly signal?: AbortSignal
  readonly request: ExportWaitRequest
  readonly subscription: SessionHostEventSubscription
}) {
  const runtime = getSessionHostEventRuntime()
  const deadline = Date.now() + input.request.query.timeoutMs
  while (true) {
    const delivery = await nextWithTimeout(
      input.subscription,
      Math.max(0, deadline - Date.now()),
      input.signal,
    )
    if (delivery.status === 'timeout') {
      const observedOperation = await readExportOperation(input.repository, input, input.request)
      if (!observedOperation) {
        return response(input.request, {
          operation: 'exports-wait',
          error: { code: 'export_not_found', message: 'Session export operation not found.' },
        })
      }
      return response(input.request, {
        operation: 'exports-wait',
        timedOut: !exportIsTerminal(observedOperation),
        cursor: runtime.eventHub.cursor(),
        export: observedOperation,
      })
    }
    if (delivery.status === 'resync-required') {
      return response(input.request, {
        operation: 'exports-wait',
        error: {
          code: 'resync_required',
          message: `Session event resynchronization is required: ${delivery.reason}.`,
        },
      })
    }
    if (delivery.status === 'closed') {
      return response(input.request, {
        operation: 'exports-wait',
        error: { code: 'host_stopped', message: 'The Session Host stopped while waiting.' },
      })
    }
    if (delivery.status === 'cursor-advanced') continue
    const payload = delivery.event.payload
    if (
      payload.kind !== 'session-export-changed' ||
      payload.exportOperationId !== input.request.query.exportOperationId
    ) {
      continue
    }
    const observedOperation = await readExportOperation(input.repository, input, input.request)
    if (!observedOperation) {
      return response(input.request, {
        operation: 'exports-wait',
        error: { code: 'export_not_found', message: 'Session export operation not found.' },
      })
    }
    if (exportIsTerminal(observedOperation)) {
      return response(input.request, {
        operation: 'exports-wait',
        timedOut: false,
        cursor: runtime.eventHub.cursor(),
        export: observedOperation,
      })
    }
  }
}

export async function waitForSessionExport(
  repository: SessionQueryRepositoryShape,
  input: {
    readonly authority?: LocalSessionProfileAuthority
    readonly resolveObservationAuthority?: () => Promise<LocalSessionProfileAuthority | undefined>
    readonly signal?: AbortSignal
    readonly request: ExportWaitRequest
  },
): Promise<SessionQueryResponse> {
  const runtime = getSessionHostEventRuntime()
  const releaseLiveness = runtime.liveness.acquire('wait')
  const snapshotCursor = runtime.eventHub.cursor()
  let subscription: ReturnType<typeof runtime.eventHub.subscribeAfter> | undefined
  try {
    throwIfAborted(input.signal)
    const operation = await readExportOperation(repository, input, input.request)
    if (!operation) {
      return response(input.request, {
        operation: 'exports-wait',
        error: { code: 'export_not_found', message: 'Session export operation not found.' },
      })
    }
    if (exportIsTerminal(operation) || input.request.query.timeoutMs === 0) {
      return response(input.request, {
        operation: 'exports-wait',
        timedOut: !exportIsTerminal(operation),
        cursor: runtime.eventHub.cursor(),
        export: operation,
      })
    }
    subscription = runtime.eventHub.subscribeAfter(
      input.request.query.after ?? snapshotCursor,
      (event) =>
        event.payload.kind === 'session-export-changed' &&
        event.payload.sessionId === input.request.query.sessionId &&
        event.payload.exportOperationId === input.request.query.exportOperationId,
    )
    if (subscription.status === 'resync-required') {
      return response(input.request, {
        operation: 'exports-wait',
        error: {
          code: 'resync_required',
          message: `Session event resynchronization is required: ${subscription.reason}.`,
        },
      })
    }
    return await waitForTerminalExport({
      repository,
      ...(input.authority ? { authority: input.authority } : {}),
      ...(input.resolveObservationAuthority
        ? { resolveObservationAuthority: input.resolveObservationAuthority }
        : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      request: input.request,
      subscription: subscription.subscription,
    })
  } finally {
    if (subscription?.status === 'ready') subscription.subscription.close()
    releaseLiveness()
  }
}
