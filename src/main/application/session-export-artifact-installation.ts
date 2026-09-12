import * as Effect from 'effect/Effect'
import type { SessionExportArtifactSink } from '../ports/session-export-artifact-writer'
import type { SessionExportOperationRepositoryShape } from '../ports/session-export-operation-repository'
import { checkExportCancellation } from './session-export-query'

function cancellationAware<A, E>(
  effect: Effect.Effect<A, E>,
  operations: SessionExportOperationRepositoryShape,
  operationId: string,
) {
  return effect.pipe(
    Effect.catchAll((error) =>
      checkExportCancellation(operations, operationId).pipe(Effect.zipRight(Effect.fail(error))),
    ),
  )
}

export function prepareDurableExportInstallation(input: {
  readonly operationId: string
  readonly sink: SessionExportArtifactSink
  readonly operations: SessionExportOperationRepositoryShape
}) {
  if (
    !input.sink.prepareFinalization ||
    !input.operations.persistArtifactPreparation ||
    !input.operations.beginArtifactInstallation
  ) {
    return Effect.succeed<boolean | undefined>(undefined)
  }
  const prepare = input.sink.prepareFinalization
  const persist = input.operations.persistArtifactPreparation
  const begin = input.operations.beginArtifactInstallation
  return Effect.gen(function* () {
    const receipt = yield* prepare()
    yield* checkExportCancellation(input.operations, input.operationId)
    yield* cancellationAware(
      persist(input.operationId, receipt, Date.now()),
      input.operations,
      input.operationId,
    )
    yield* checkExportCancellation(input.operations, input.operationId)
    const installationClaimed = yield* cancellationAware(
      begin(input.operationId, Date.now()),
      input.operations,
      input.operationId,
    )
    if (!installationClaimed) {
      yield* checkExportCancellation(input.operations, input.operationId)
      return yield* Effect.fail(new Error('Export artifact installation could not be claimed.'))
    }
    return true
  })
}
