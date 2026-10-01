import { SESSION_TITLE_MODEL_OFF, type SessionTitleModelSetting } from '@shared/session-title-model'
import type { SessionTitleSource } from '@shared/session-title-source'
import type { SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
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
  return () => {
    inFlight.delete(key)
  }
}

export function publishTitleChanged(sessionId: SessionId) {
  publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
}

export type EnabledTitleModel = Exclude<SessionTitleModelSetting, typeof SESSION_TITLE_MODEL_OFF>

/** The current Title model, or null when it is Off. Read before every request, retries included. */
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

/**
 * Sends one title request. Background work takes one of `TITLE_REQUEST_CONCURRENCY` Host-wide
 * permits; a request a person is waiting for (`priority: 'user'`) skips the queue, so a burst of
 * Worker titles never holds up a Regenerate.
 */
export function generateTitle(input: {
  readonly state: SessionTitleState
  readonly titleModel: EnabledTitleModel
  readonly sessionModel: SupportedModelId | null
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
    const request = generator
      .generate({
        sessionModel: input.sessionModel ?? input.state.executionModel,
        titleModel: input.titleModel,
        ...prompt,
      })
      .pipe(
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
