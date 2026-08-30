import * as Effect from 'effect/Effect'
import type { SessionExportArtifactSink } from '../ports/session-export-artifact-writer'
import type { SessionExportOperationRepositoryShape } from '../ports/session-export-operation-repository'

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
    yield* persist(input.operationId, receipt, Date.now())
    return yield* begin(input.operationId, Date.now())
  })
}
