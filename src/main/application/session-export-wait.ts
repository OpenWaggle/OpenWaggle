import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SessionExportOperationSummary } from '@shared/types/session-export-operation'
import type { SessionQueryRequest, SessionQueryResponse } from '@shared/types/session-query'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import type { SessionQueryRepositoryShape } from '../ports/session-query-repository'
import { getSessionHostEventRuntime } from '../session-host/session-host-events'
import { throwIfAborted, waitForSessionHostCondition } from './session-host-condition-wait'
import { acquireWaitLiveness } from './session-host-run-admission'

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
          ...(request.query.includeQueueBodies ? { includeQueueBodies: true } : {}),
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

function exportResponse(request: ExportWaitRequest, operation: SessionExportOperationSummary) {
  return response(request, {
    operation: 'exports-wait',
    timedOut: !exportIsTerminal(operation),
    cursor: getSessionHostEventRuntime().eventHub.cursor(),
    export: operation,
  })
}

function exportNotFound(request: ExportWaitRequest) {
  return response(request, {
    operation: 'exports-wait',
    error: { code: 'export_not_found', message: 'Session export operation not found.' },
  })
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
  const releaseLiveness = acquireWaitLiveness(runtime.liveness)
  const snapshotCursor = runtime.eventHub.cursor()
  try {
    throwIfAborted(input.signal)
    const operation = await readExportOperation(repository, input, input.request)
    if (!operation) return exportNotFound(input.request)
    if (exportIsTerminal(operation) || input.request.query.timeoutMs === 0) {
      return exportResponse(input.request, operation)
    }
    const query = input.request.query
    const observation = await waitForSessionHostCondition({
      eventHub: runtime.eventHub,
      after: query.after ?? snapshotCursor,
      accepts: (event) =>
        event.payload.kind === 'session-export-changed' &&
        event.payload.sessionId === query.sessionId &&
        event.payload.exportOperationId === query.exportOperationId,
      read: () => readExportOperation(repository, input, input.request),
      matches: exportIsTerminal,
      deadline: Date.now() + query.timeoutMs,
      ...(input.signal ? { signal: input.signal } : {}),
    })
    if (observation.status === 'missing') return exportNotFound(input.request)
    if (observation.status === 'host-stopped') {
      return response(input.request, {
        operation: 'exports-wait',
        error: { code: 'host_stopped', message: 'The Session Host stopped while waiting.' },
      })
    }
    return exportResponse(input.request, observation.value)
  } finally {
    releaseLiveness()
  }
}
