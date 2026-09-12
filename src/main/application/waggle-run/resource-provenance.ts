import type { SessionId } from '@shared/types/brand'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import type { SessionRepositoryShape } from '../../ports/session-repository'

const logger = createLogger('waggle-run-service')

export function loadPersistedWaggleResourceProvenanceTree(
  sessionRepository: SessionRepositoryShape,
  run: { readonly sessionId: SessionId; readonly runId: string },
) {
  return sessionRepository.getTree(run.sessionId).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        logger.warn('Failed to reload persisted Waggle tree for resource provenance', {
          sessionId: run.sessionId,
          runId: run.runId,
          error: formatErrorMessage(error),
        })
        return null
      }),
    ),
  )
}
