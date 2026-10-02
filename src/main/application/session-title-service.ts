import { SESSION_TITLE_SOURCES } from '@shared/session-title-source'
import type { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionTitleRegenerationResult } from '@shared/types/session-title'
import * as Effect from 'effect/Effect'
import * as Schedule from 'effect/Schedule'
import type { SessionTitleContextAttachment } from '../domain/session-title/session-title-context'
import {
  formatSessionTitleContext,
  toSessionTitleContextMessage,
} from '../domain/session-title/session-title-context'
import { SessionTitleGenerationError } from '../errors'
import { createLogger } from '../logger'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import type { SessionTitleGenerator } from '../ports/session-title-generator'
import { SessionTitleRepository } from '../ports/session-title-repository'
import type { SettingsService } from '../services/settings-service'
import {
  claimTitleWork,
  enabledTitleModel,
  GENERATABLE_SOURCES,
  generateTitle,
  publishTitleChanged,
} from './session-title-generation'
import { refineSessionTitle } from './session-title-refinement'

const logger = createLogger('session-title-service')

/** T3 Code retries a first title twice with exponential backoff before keeping the seed. */
const INITIAL_TITLE_RETRY = Schedule.intersect(
  Schedule.exponential('2 seconds'),
  Schedule.recurs(2),
)
const FAILURE_MESSAGE_MAX_LENGTH = 200
/** A Regenerate a person is waiting for ends with a message instead of spinning forever. */
const REGENERATION_TIMEOUT = '60 seconds'

function generateInitial(input: {
  readonly sessionId: SessionId
  readonly text: string
  readonly attachments: readonly SessionTitleContextAttachment[]
  readonly model: SupportedModelId | null
  readonly settleOnFailure: boolean
}) {
  return Effect.gen(function* () {
    const repository = yield* SessionTitleRepository
    const state = yield* repository.getState(input.sessionId)
    if (!state || !GENERATABLE_SOURCES.includes(state.source)) return
    // The setting is read again before every attempt, so turning the Title model Off stops the
    // retries of a request already under way.
    const attempt = yield* Effect.gen(function* () {
      const titleModel = yield* enabledTitleModel()
      if (titleModel === null) return { kind: 'off' } as const
      const generated = yield* generateTitle({
        state,
        sessionModel: input.model,
        message: input.text,
        attachments: input.attachments,
      })
      return { kind: 'generated', generated } as const
    }).pipe(
      Effect.retry({
        schedule: INITIAL_TITLE_RETRY,
        while: (error) =>
          error._tag !== 'SessionTitleGenerationError' ||
          (error.reason !== 'no-model' && error.reason !== 'off'),
      }),
      // After the retries, a failed request settles like a reply with no usable title, so Host
      // restarts do not spend the same request again on every start.
      Effect.catchTag('SessionTitleGenerationError', (error) =>
        Effect.sync(() => {
          if (error.reason === 'off') return { kind: 'off' } as const
          logger.warn('Title model request failed; keeping the current title', {
            sessionId: input.sessionId,
            reason: error.reason,
          })
          return { kind: 'failed', generated: null } as const
        }),
      ),
    )
    if (attempt.kind === 'off') return
    // A request made at creation fails without settling: the first Run asks again, so a Worker
    // queued behind a rate-limit burst still gets a second chance.
    if (attempt.kind === 'failed' && !input.settleOnFailure) return
    const { generated } = attempt
    // As in T3 Code, a reply with no usable title keeps the current title and owes a root one
    // refinement, which names the Session once its first turn has an answer. A first message with
    // only an attachment is always owed one: its subject is in the reply, not the request. A
    // Worker is never refined, so its Provisional title simply becomes its title.
    const needsRefinement =
      !state.isWorker && (!generated || generated.needsRefinement || !input.text.trim())
    const applied = yield* repository.applyGenerated({
      sessionId: input.sessionId,
      expected: { title: state.title, sources: GENERATABLE_SOURCES },
      title: generated?.title ?? state.title,
      needsRefinement,
    })
    if (!applied) return
    if (generated) publishTitleChanged(input.sessionId)
    // A fast first turn may have answered before this title landed; refine it now in that case.
    if (needsRefinement) yield* refineSessionTitle(input.sessionId)
  })
}

/**
 * Replaces a default or Provisional title with a generated one. Callers run it in the background
 * so it never delays the Run or Spawn that triggered it; a failure keeps the current title.
 */
export function generateInitialSessionTitle(input: {
  readonly sessionId: SessionId
  readonly text: string
  readonly attachments?: readonly SessionTitleContextAttachment[]
  readonly model?: SupportedModelId | null
  /** False for a request made at creation, before the first Run, which will ask again. */
  readonly settleOnFailure?: boolean
}) {
  return Effect.gen(function* () {
    const attachments = input.attachments ?? []
    if (!input.text.trim() && attachments.length === 0) return
    const release = claimTitleWork('initial', input.sessionId)
    if (!release) return
    yield* generateInitial({
      sessionId: input.sessionId,
      text: input.text,
      attachments,
      model: input.model ?? null,
      settleOnFailure: input.settleOnFailure ?? true,
    }).pipe(
      Effect.catchAllCause((cause) =>
        Effect.sync(() => {
          logger.warn('Title generation failed; keeping the current title', {
            sessionId: input.sessionId,
            cause: String(cause),
          })
        }),
      ),
      Effect.ensuring(Effect.sync(release)),
    )
  })
}

function failureMessage(error: SessionTitleGenerationError) {
  const message = error.message.replace(/\s+/g, ' ').trim() || 'The Title model request failed.'
  return message.length <= FAILURE_MESSAGE_MAX_LENGTH
    ? message
    : `${message.slice(0, FAILURE_MESSAGE_MAX_LENGTH - 1)}…`
}

function regenerate(
  sessionId: SessionId,
): Effect.Effect<
  SessionTitleRegenerationResult,
  unknown,
  SessionTitleRepository | SessionTitleGenerator | SettingsService | SessionProjectionRepository
> {
  return Effect.gen(function* () {
    const titleModel = yield* enabledTitleModel()
    if (titleModel === null) return { outcome: 'unavailable', reason: 'off' } as const
    const repository = yield* SessionTitleRepository
    const state = yield* repository.getState(sessionId)
    if (!state) return { outcome: 'failed', message: 'The session no longer exists.' } as const
    const session = yield* (yield* SessionProjectionRepository).get(sessionId)
    const context = formatSessionTitleContext(session.messages.map(toSessionTitleContextMessage))
    if (!context.message.trim()) return { outcome: 'unavailable', reason: 'empty' } as const
    const generated = yield* generateTitle({
      state,
      sessionModel: null,
      message: context.message,
      previousTitle: state.title,
      attachments: context.attachments,
      priority: 'user',
    }).pipe(
      Effect.timeoutFail({
        duration: REGENERATION_TIMEOUT,
        onTimeout: () =>
          new SessionTitleGenerationError({
            reason: 'request-failed',
            message: 'The Title model did not answer in time.',
          }),
      }),
      Effect.either,
    )
    if (generated._tag === 'Left') {
      const { reason } = generated.left
      return reason === 'no-model' || reason === 'off'
        ? ({ outcome: 'unavailable', reason } as const)
        : ({ outcome: 'failed', message: failureMessage(generated.left) } as const)
    }
    const title = generated.right?.title
    if (!title) return { outcome: 'failed', message: 'The Title model returned no title.' } as const
    if (title === state.title) return { outcome: 'unchanged', title } as const
    const applied = yield* repository.applyGenerated({
      sessionId,
      expected: { title: state.title, sources: SESSION_TITLE_SOURCES },
      title,
      needsRefinement: false,
    })
    if (!applied) return { outcome: 'superseded' } as const
    publishTitleChanged(sessionId)
    return { outcome: 'renamed', title } as const
  })
}

/**
 * Title regeneration: the user asked for a new title from the whole history. It is applied
 * directly, and superseded if the title changes while it runs (ADR 0043).
 */
export function regenerateSessionTitle(sessionId: SessionId) {
  return Effect.gen(function* () {
    const release = claimTitleWork('regenerate', sessionId)
    if (!release) return { outcome: 'unavailable', reason: 'busy' } as const
    return yield* regenerate(sessionId).pipe(Effect.ensuring(Effect.sync(release)))
  })
}
