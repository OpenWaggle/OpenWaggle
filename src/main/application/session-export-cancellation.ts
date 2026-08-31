import type {
  SessionControlMutationResponse,
  SessionExportCancelMutationRequest,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { SessionExportArtifactWriter } from '../ports/session-export-artifact-writer'
import { SessionExportOperationRepository } from '../ports/session-export-operation-repository'
import { publishSessionHostEvent } from '../session-host/session-host-events'

export function cancelSessionExport(input: {
  readonly request: SessionExportCancelMutationRequest
}) {
  return Effect.gen(function* () {
    const repository = yield* SessionExportOperationRepository
    const artifacts = yield* SessionExportArtifactWriter
    const result = yield* repository.requestCancellation({
      sessionId: input.request.command.sessionId,
      exportOperationId: input.request.command.exportOperationId,
      now: Date.now(),
    })
    if (result.operation.status === 'cancelled') yield* artifacts.discard(result.operation)
    publishSessionHostEvent({
      kind: 'session-export-changed',
      sessionId: result.operation.sessionId,
      exportOperationId: result.operation.exportOperationId,
      status: result.operation.status,
      progress: result.operation.progress,
    })
    return {
      contractVersion: input.request.contractVersion,
      requestId: input.request.requestId,
      idempotencyKey: input.request.idempotencyKey,
      replayed: result.replayed,
      outcome: {
        operation: 'export-cancel',
        effect: 'export-cancellation-requested',
        sessionId: result.operation.sessionId,
        exportOperationId: result.operation.exportOperationId,
        status: result.operation.status,
      },
    } satisfies SessionControlMutationResponse
  })
}
