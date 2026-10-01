import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import {
  formatSessionTitleContext,
  toSessionTitleContextMessage,
} from '../domain/session-title/session-title-context'
import { createLogger } from '../logger'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionTitleRepository } from '../ports/session-title-repository'
import {
  claimTitleWork,
  enabledTitleModel,
  generateTitle,
  isWithinTitleWorkWindow,
  publishTitleChanged,
} from './session-title-generation'

const logger = createLogger('session-title-refinement')

/** Refinement triggers that arrived while one was running for the same Session. */
const refineAgain = new Set<SessionId>()

function settle(sessionId: SessionId) {
  return Effect.flatMap(SessionTitleRepository, (repository) =>
    repository.clearRefinement(sessionId),
  )
}

function refine(sessionId: SessionId) {
  return Effect.gen(function* () {
    const titleModel = yield* enabledTitleModel()
    if (titleModel === null) return
    const repository = yield* SessionTitleRepository
    const state = yield* repository.getState(sessionId)
    if (!state?.needsRefinement || state.source !== 'generated' || state.archived) return
    if (state.isWorker) return yield* settle(sessionId)
    const session = yield* (yield* SessionProjectionRepository).get(sessionId)
    const userMessages = session.messages.filter((message) => message.role === 'user')
    // The first turn may not be persisted yet; its Run triggers the refinement when it ends.
    const first = userMessages[0]
    if (!first) return
    if (userMessages.length > 1 || !isWithinTitleWorkWindow(first.createdAt, Date.now())) {
      return yield* settle(sessionId)
    }
    const context = formatSessionTitleContext(session.messages.map(toSessionTitleContextMessage))
    const answered = session.messages.some(
      (message) =>
        message.role === 'assistant' && toSessionTitleContextMessage(message).text.trim(),
    )
    // The first turn has not answered yet; the Run that answers it triggers the refinement.
    if (!answered) return
    const generated = yield* generateTitle({
      state,
      titleModel,
      sessionModel: null,
      message: context.message,
      previousTitle: state.title,
      attachments: context.attachments,
    }).pipe(Effect.catchTag('SessionTitleGenerationError', () => Effect.succeed(null)))
    if (!generated || generated.title === state.title) return yield* settle(sessionId)
    const applied = yield* repository.applyGenerated({
      sessionId,
      expected: { title: state.title, sources: ['generated'] },
      title: generated.title,
      needsRefinement: false,
    })
    if (applied) publishTitleChanged(sessionId)
    else yield* settle(sessionId)
  })
}

/**
 * Runs the single Title refinement a vague first request is owed, once its first turn has an
 * answer. A trigger that arrives while one runs is remembered and run afterwards, so a Run that
 * ends during an inline refinement is never lost. Never fails; callers run it in the background.
 */
export function refineSessionTitle(sessionId: SessionId) {
  return Effect.gen(function* () {
    const release = claimTitleWork('refine', sessionId)
    if (!release) {
      refineAgain.add(sessionId)
      return
    }
    yield* Effect.gen(function* () {
      do {
        refineAgain.delete(sessionId)
        yield* refine(sessionId)
      } while (refineAgain.has(sessionId))
    }).pipe(
      Effect.catchAllCause((cause) =>
        Effect.sync(() => {
          logger.warn('Title refinement failed', { sessionId, cause: String(cause) })
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          refineAgain.delete(sessionId)
          release()
        }),
      ),
    )
  })
}
