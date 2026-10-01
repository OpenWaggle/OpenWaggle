import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { toSessionTitleContextMessage } from '../domain/session-title/session-title-context'
import { createLogger } from '../logger'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionTitleRepository } from '../ports/session-title-repository'
import { TITLE_WORK_WINDOW_MS } from './session-title-generation'
import { refineSessionTitle } from './session-title-refinement'
import { generateInitialSessionTitle } from './session-title-service'

const logger = createLogger('session-title-recovery')

const RECOVERY_LIMIT = 20

/** A Provisional title whose generation a Host restart cut off is generated again from its first message. */
function resumeProvisional(sessionId: SessionId) {
  return Effect.gen(function* () {
    const session = yield* (yield* SessionProjectionRepository).get(sessionId)
    const first = session.messages.find((message) => message.role === 'user')
    // No first message yet: the first Run's preflight asks for the title itself.
    if (!first) return
    const message = toSessionTitleContextMessage(first)
    yield* generateInitialSessionTitle({
      sessionId,
      text: message.text,
      attachments: message.attachments,
    })
  })
}

/**
 * Resumes title work a Host restart interrupted: generation for recent Provisional titles and the
 * refinements recent Sessions are still owed. Older owed refinements are settled instead.
 */
export const recoverSessionTitleWork = Effect.gen(function* () {
  const repository = yield* SessionTitleRepository
  const createdAfter = Date.now() - TITLE_WORK_WINDOW_MS
  yield* repository.settleRefinementsCreatedBefore(createdAfter)
  for (const sessionId of yield* repository.listRecentProvisional({
    createdAfter,
    limit: RECOVERY_LIMIT,
  })) {
    yield* resumeProvisional(sessionId)
  }
  for (const sessionId of yield* repository.listPendingRefinements({
    createdAfter,
    limit: RECOVERY_LIMIT,
  })) {
    yield* refineSessionTitle(sessionId)
  }
}).pipe(
  Effect.catchAllCause((cause) =>
    Effect.sync(() => {
      logger.warn('Could not resume interrupted title work', { cause: String(cause) })
    }),
  ),
)
