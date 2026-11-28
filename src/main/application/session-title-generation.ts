import {
  SESSION_TITLE_MODEL_AUTOMATIC,
  SESSION_TITLE_MODEL_OFF,
  type SessionTitleModelSetting,
} from '@shared/session-title-model'
import type { SessionTitleSource } from '@shared/session-title-source'
import { type SessionId, SupportedModelId } from '@shared/types/brand'
import { parseModelRef } from '@shared/types/llm'
import { loadProjectProviderRestriction } from './project-provider-restriction'
import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { lastAnsweringModelReference } from '../domain/session-model-fallback'
import type { SessionTitleContextAttachment } from '../domain/session-title/session-title-context'
import { parseGeneratedSessionTitle } from '../domain/session-title/session-title-output'
import { buildSessionTitlePrompt } from '../domain/session-title/session-title-prompts'
import { SessionTitleGenerationError } from '../errors'
import { SessionTitleGenerator } from '../ports/session-title-generator'
import type { SessionTitleState } from '../ports/session-title-repository'
import { SettingsService } from '../services/settings-service'
import { publishSessionHostEvent } from '../session-host/session-host-events'

export const GENERATABLE_SOURCES: readonly SessionTitleSource[] = ['default', 'provisional']

/**
 * Title work belongs to a Session's start. A refinement whose first message is older than this, or
 * a Session idle for longer, is settled rather than generated, so switching the Title model back
 * on never retitles weeks-old Sessions.
 */
export const TITLE_WORK_WINDOW_MS = 24 * 60 * 60 * 1000
/**
 * Bounds one background request end to end, including model-runtime setup that has no timeout of
 * its own, so a stuck provider never holds a Host-wide permit.
 */
const TITLE_REQUEST_TIMEOUT = '90 seconds'

/**
 * Title requests share the Session model's provider and rate limit with the Runs they title. A
 * Queen spawning many Workers at once would otherwise send that many title requests together.
 */
const TITLE_REQUEST_CONCURRENCY = 2
const titleRequestPermits = Effect.unsafeMakeSemaphore(TITLE_REQUEST_CONCURRENCY)

export type TitleWorkKind = 'initial' | 'refine' | 'regenerate'

/** One generation of each kind per Session at a time, so repeated triggers never stack requests. */
const inFlight = new Set<string>()

export function claimTitleWork(kind: TitleWorkKind, sessionId: SessionId) {
  const key = `${kind}:${sessionId}`
  if (inFlight.has(key)) return null
  inFlight.add(key)
  let released = false
  // Idempotent, so releasing early never frees a later claim of the same key.
  return () => {
    if (released) return
    released = true
    inFlight.delete(key)
  }
}

export function publishTitleChanged(sessionId: SessionId) {
  publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
}

/**
 * The current Title model, or null when it is Off. Callers read it before starting title work, and
 * `generateTitle` reads it again once a request may be sent, so turning the Title model Off stops
 * queued requests and retries as well.
 */
export function enabledTitleModel() {
  return Effect.gen(function* () {
    const settings = yield* (yield* SettingsService).get()
    const setting = settings.sessionTitleModel
    return setting === SESSION_TITLE_MODEL_OFF ? null : setting
  })
}

/** Whether a moment, such as a Session's first message, is still within the title-work window. */
export function isWithinTitleWorkWindow(at: number, now: number) {
  return now - at <= TITLE_WORK_WINDOW_MS
}

interface TitleRequestModels {
  readonly titleModel: Exclude<SessionTitleModelSetting, 'off'>
  readonly sessionModel: SupportedModelId | null
  readonly fallbackModel?: SupportedModelId
}

/**
 * The models a Title request may use under the project's provider restrictions, or null when none
 * may (CONTEXT.md, "Provider restriction"). A title is cosmetic, so nothing here fails loudly:
 * - an explicit Title model from a refused provider falls back to Automatic;
 * - a refused fallback model is dropped;
 * - a Session model from a refused provider is never billed: Automatic follows it, so only an
 *   allowed explicit Title model may write the title then, standing in for the Session model;
 * - a project settings file that cannot be read writes no title, as it refuses the Session's Runs.
 * A Session without a project is never restricted.
 */
export function titleRequestWithinProviderRestrictions(
  input: TitleRequestModels & { readonly projectPath: string | null },
) {
  return Effect.gen(function* () {
    const { projectPath, ...unchanged } = input
    if (!projectPath) return unchanged
    const settings = yield* (yield* SettingsService).get().pipe(Effect.orElseSucceed(() => null))
    if (settings === null) return unchanged
    const restriction = yield* loadProjectProviderRestriction(settings, projectPath).pipe(
      Effect.orElseSucceed(() => null),
    )
    if (restriction === null) return null
    const allows = (model: string) => {
      const provider = parseModelRef(model.trim())?.provider
      return provider === undefined || restriction.allows(provider)
    }
    const titleModel =
      parseModelRef(input.titleModel) !== null && !allows(input.titleModel)
        ? SESSION_TITLE_MODEL_AUTOMATIC
        : input.titleModel
    const fallbackModel =
      input.fallbackModel !== undefined && allows(input.fallbackModel)
        ? { fallbackModel: input.fallbackModel }
        : {}
    if (input.sessionModel === null || allows(input.sessionModel)) {
      return { titleModel, sessionModel: input.sessionModel, ...fallbackModel }
    }
    if (titleModel === SESSION_TITLE_MODEL_AUTOMATIC) return null
    return { titleModel, sessionModel: SupportedModelId(titleModel) }
  })
}

/** The fallback a Title request of a loaded Session carries: the model that answered it last. */
export function sessionTitleFallbackModel(session: Pick<SessionDetail, 'messages'>) {
  const fallbackModel = lastAnsweringModelReference(session)
  return fallbackModel ? { fallbackModel: SupportedModelId(fallbackModel) } : {}
}

/**
 * Sends one title request. Background work takes one of `TITLE_REQUEST_CONCURRENCY` Host-wide
 * permits; a request a person is waiting for (`priority: 'user'`) skips the queue, so a burst of
 * Worker titles never holds up a Regenerate.
 */
export function generateTitle(input: {
  readonly state: SessionTitleState
  readonly sessionModel: SupportedModelId | null
  /** The model that answered the Session last, used when the Session model is gone. */
  readonly fallbackModel?: SupportedModelId
  readonly message: string
  readonly previousTitle?: string
  readonly attachments?: readonly SessionTitleContextAttachment[]
  readonly priority?: 'background' | 'user'
}) {
  return Effect.gen(function* () {
    const generator = yield* SessionTitleGenerator
    const prompt = buildSessionTitlePrompt({
      message: input.message,
      ...(input.previousTitle === undefined ? {} : { previousTitle: input.previousTitle }),
      ...(input.attachments ? { attachments: input.attachments } : {}),
    })
    const request = Effect.gen(function* () {
      // A queued request may have waited while the Title model was turned Off or changed. A
      // setting that cannot be read counts as Off.
      const titleModel = yield* enabledTitleModel().pipe(Effect.orElseSucceed(() => null))
      if (titleModel === null) {
        return yield* Effect.fail(
          new SessionTitleGenerationError({ reason: 'off', message: 'The Title model is Off.' }),
        )
      }
      const models = yield* titleRequestWithinProviderRestrictions({
        projectPath: input.state.projectPath,
        // The request's Title model type excludes Off, which an enabled setting never is here.
        titleModel:
          titleModel === SESSION_TITLE_MODEL_OFF ? SESSION_TITLE_MODEL_AUTOMATIC : titleModel,
        sessionModel: input.sessionModel ?? input.state.executionModel,
        ...(input.fallbackModel ? { fallbackModel: input.fallbackModel } : {}),
      })
      if (models === null) {
        return yield* Effect.fail(
          new SessionTitleGenerationError({
            reason: 'no-model',
            message: "No Title model uses a provider this project's provider restrictions allow.",
          }),
        )
      }
      return yield* generator.generate({
        projectPath: input.state.projectPath,
        ...models,
        ...prompt,
        ...(input.priority === 'user' ? { retryRefusedModels: true } : {}),
      })
    }).pipe(
      Effect.timeoutFail({
        duration: TITLE_REQUEST_TIMEOUT,
        onTimeout: () =>
          new SessionTitleGenerationError({
            reason: 'request-failed',
            message: 'The Title model did not answer in time.',
          }),
      }),
    )
    const response = yield* input.priority === 'user'
      ? request
      : titleRequestPermits.withPermits(1)(request)
    return parseGeneratedSessionTitle(response.text)
  })
}
