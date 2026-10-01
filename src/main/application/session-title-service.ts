import type { SessionTitleModelSetting } from '@shared/session-title-model'
import { SESSION_TITLE_MODEL_OFF } from '@shared/session-title-model'
import { SESSION_TITLE_SOURCES, type SessionTitleSource } from '@shared/session-title-source'
import type { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionTitleRegenerationResult } from '@shared/types/session-title'
import * as Effect from 'effect/Effect'
import * as Schedule from 'effect/Schedule'
import type { SessionTitleContextAttachment } from '../domain/session-title/session-title-context'
import {
  formatSessionTitleContext,
  toSessionTitleContextMessage,
} from '../domain/session-title/session-title-context'
import { parseGeneratedSessionTitle } from '../domain/session-title/session-title-output'
import { buildSessionTitlePrompt } from '../domain/session-title/session-title-prompts'
import type { SessionTitleGenerationError } from '../errors'
import { createLogger } from '../logger'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionTitleGenerator } from '../ports/session-title-generator'
import { SessionTitleRepository, type SessionTitleState } from '../ports/session-title-repository'
import { SettingsService } from '../services/settings-service'
import { publishSessionHostEvent } from '../session-host/session-host-events'

const logger = createLogger('session-title-service')

/** T3 Code retries a first title twice with exponential backoff before keeping the seed. */
const INITIAL_TITLE_RETRY = Schedule.intersect(
  Schedule.exponential('2 seconds'),
  Schedule.recurs(2),
)
const PENDING_REFINEMENT_RECOVERY_LIMIT = 20
const FAILURE_MESSAGE_MAX_LENGTH = 200
const GENERATABLE_SOURCES: readonly SessionTitleSource[] = ['default', 'provisional']

/** One generation of each kind per Session at a time, so repeated triggers never stack requests. */
const inFlight = new Set<string>()

function claim(kind: 'initial' | 'refine' | 'regenerate', sessionId: SessionId) {
  const key = `${kind}:${sessionId}`
  if (inFlight.has(key)) return null
  inFlight.add(key)
  return () => {
    inFlight.delete(key)
  }
}

function publishTitleChanged(sessionId: SessionId) {
  publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
}

function titleModelSetting() {
  return Effect.gen(function* () {
    const settings = yield* (yield* SettingsService).get()
    return settings.sessionTitleModel
  })
}

function generate(input: {
  readonly state: SessionTitleState
  readonly titleModel: Exclude<SessionTitleModelSetting, 'off'>
  readonly sessionModel: SupportedModelId | null
  readonly message: string
  readonly previousTitle?: string
  readonly attachments?: readonly SessionTitleContextAttachment[]
}) {
  return Effect.gen(function* () {
    const generator = yield* SessionTitleGenerator
    const prompt = buildSessionTitlePrompt({
      message: input.message,
      ...(input.previousTitle === undefined ? {} : { previousTitle: input.previousTitle }),
      ...(input.attachments ? { attachments: input.attachments } : {}),
    })
    const response = yield* generator.generate({
      sessionModel: input.sessionModel ?? input.state.executionModel,
      titleModel: input.titleModel,
      ...prompt,
    })
    return parseGeneratedSessionTitle(response.text)
  })
}

function isTitleModelEnabled(
  setting: SessionTitleModelSetting,
): setting is Exclude<SessionTitleModelSetting, 'off'> {
  return setting !== SESSION_TITLE_MODEL_OFF
}

function settleRefinement(sessionId: SessionId) {
  return Effect.flatMap(SessionTitleRepository, (repository) =>
    repository.clearRefinement(sessionId),
  )
}

function refine(sessionId: SessionId) {
  return Effect.gen(function* () {
    const titleModel = yield* titleModelSetting()
    if (!isTitleModelEnabled(titleModel)) return
    const repository = yield* SessionTitleRepository
    const state = yield* repository.getState(sessionId)
    if (!state?.needsRefinement || state.source !== 'generated' || state.archived) return
    if (state.isWorker) return yield* settleRefinement(sessionId)
    const session = yield* (yield* SessionProjectionRepository).get(sessionId)
    const userMessages = session.messages.filter((message) => message.role === 'user').length
    // The first turn may not be persisted yet; its Run triggers the refinement when it ends.
    if (userMessages === 0) return
    if (userMessages > 1) return yield* settleRefinement(sessionId)
    const context = formatSessionTitleContext(session.messages.map(toSessionTitleContextMessage))
    const answered = session.messages.some(
      (message) =>
        message.role === 'assistant' && toSessionTitleContextMessage(message).text.trim(),
    )
    // The first turn has not answered yet; the Run that answers it triggers the refinement.
    if (!answered) return
    const generated = yield* generate({
      state,
      titleModel,
      sessionModel: null,
      message: context.message,
      previousTitle: state.title,
      attachments: context.attachments,
    }).pipe(Effect.catchTag('SessionTitleGenerationError', () => Effect.succeed(null)))
    if (!generated || generated.title === state.title) return yield* settleRefinement(sessionId)
    const applied = yield* repository.applyGenerated({
      sessionId,
      expected: { title: state.title, sources: ['generated'] },
      title: generated.title,
      needsRefinement: false,
    })
    if (applied) publishTitleChanged(sessionId)
    else yield* settleRefinement(sessionId)
  })
}

/**
 * Runs the single Title refinement a vague first request is owed, once its first turn has an
 * answer. Never fails; callers run it in the background.
 */
export function refineSessionTitle(sessionId: SessionId) {
  return Effect.gen(function* () {
    const release = claim('refine', sessionId)
    if (!release) return
    yield* refine(sessionId).pipe(
      Effect.catchAllCause((cause) =>
        Effect.sync(() => {
          logger.warn('Title refinement failed', { sessionId, cause: String(cause) })
        }),
      ),
      Effect.ensuring(Effect.sync(release)),
    )
  })
}

function generateInitial(input: {
  readonly sessionId: SessionId
  readonly text: string
  readonly attachments: readonly SessionTitleContextAttachment[]
  readonly model: SupportedModelId | null
}) {
  return Effect.gen(function* () {
    const titleModel = yield* titleModelSetting()
    if (!isTitleModelEnabled(titleModel)) return
    const repository = yield* SessionTitleRepository
    const state = yield* repository.getState(input.sessionId)
    if (!state || !GENERATABLE_SOURCES.includes(state.source)) return
    const generated = yield* generate({
      state,
      titleModel,
      sessionModel: input.model,
      message: input.text,
      attachments: input.attachments,
    }).pipe(
      Effect.retry({
        schedule: INITIAL_TITLE_RETRY,
        while: (error) => error.reason !== 'no-model',
      }),
    )
    // As in T3 Code, a reply with no usable title keeps the Provisional title and owes a root one
    // refinement, which names the Session once its first turn has an answer.
    if (!generated && (state.isWorker || state.source !== 'provisional')) return
    const needsRefinement = (generated?.needsRefinement ?? true) && !state.isWorker
    const applied = yield* repository.applyGenerated({
      sessionId: input.sessionId,
      expected: { title: state.title, sources: GENERATABLE_SOURCES },
      title: generated?.title ?? state.title,
      needsRefinement,
    })
    if (!applied) return
    publishTitleChanged(input.sessionId)
    // A fast first turn may have answered before this title landed; refine it now in that case.
    if (needsRefinement) yield* refineSessionTitle(input.sessionId)
  })
}

/**
 * Replaces a Provisional title with a generated one. Callers run it in the background so it never
 * delays the Run or Spawn that triggered it; a failure keeps the Provisional title.
 */
export function generateInitialSessionTitle(input: {
  readonly sessionId: SessionId
  readonly text: string
  readonly attachments?: readonly SessionTitleContextAttachment[]
  readonly model?: SupportedModelId | null
}) {
  return Effect.gen(function* () {
    if (!input.text.trim()) return
    const release = claim('initial', input.sessionId)
    if (!release) return
    yield* generateInitial({
      sessionId: input.sessionId,
      text: input.text,
      attachments: input.attachments ?? [],
      model: input.model ?? null,
    }).pipe(
      Effect.catchAllCause((cause) =>
        Effect.sync(() => {
          logger.warn('Title generation failed; keeping the Provisional title', {
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
    const titleModel = yield* titleModelSetting()
    if (!isTitleModelEnabled(titleModel)) return { outcome: 'unavailable', reason: 'off' } as const
    const repository = yield* SessionTitleRepository
    const state = yield* repository.getState(sessionId)
    if (!state) return { outcome: 'failed', message: 'The session no longer exists.' } as const
    const session = yield* (yield* SessionProjectionRepository).get(sessionId)
    const context = formatSessionTitleContext(session.messages.map(toSessionTitleContextMessage))
    if (!context.message.trim()) return { outcome: 'unavailable', reason: 'empty' } as const
    const generated = yield* generate({
      state,
      titleModel,
      sessionModel: null,
      message: context.message,
      previousTitle: state.title,
      attachments: context.attachments,
    }).pipe(Effect.either)
    if (generated._tag === 'Left') {
      return generated.left.reason === 'no-model'
        ? ({ outcome: 'unavailable', reason: 'no-model' } as const)
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
    const release = claim('regenerate', sessionId)
    if (!release) return { outcome: 'unavailable', reason: 'busy' } as const
    return yield* regenerate(sessionId).pipe(Effect.ensuring(Effect.sync(release)))
  })
}

/** Resumes Title refinements a Host restart interrupted. */
export const recoverPendingSessionTitleRefinements = Effect.gen(function* () {
  const pending = yield* (yield* SessionTitleRepository).listPendingRefinements(
    PENDING_REFINEMENT_RECOVERY_LIMIT,
  )
  for (const sessionId of pending) yield* refineSessionTitle(sessionId)
}).pipe(
  Effect.catchAllCause((cause) =>
    Effect.sync(() => {
      logger.warn('Could not resume pending Title refinements', { cause: String(cause) })
    }),
  ),
)
