import { boundGeneratedSessionTitle } from '@shared/session-title'
import { DEFAULT_SESSION_TITLE } from '@shared/session-title-source'
import { type SessionId, SupportedModelId } from '@shared/types/brand'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { buildDeterministicTitle } from '../agent/title-generator'
import { createLogger } from '../logger'
import {
  PiSessionDiscoveryRepository,
  PiSessionFiles,
  type PiSessionTitleSource,
  type TitleOwedDiscoveredSession,
} from '../ports/pi-session-discovery'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionTitleRepository, type SessionTitleState } from '../ports/session-title-repository'
import {
  isWithinTitleWorkWindow,
  publishTitleChanged,
  TITLE_WORK_WINDOW_MS,
} from './session-title-generation'
import { requestInitialSessionTitle } from './session-title-scheduler'

/**
 * Titles of discovered Pi sessions (ADR 0051). Without a Pi `/name`, a discovered session is
 * titled like a Session started in OpenWaggle (ADR 0043): its first user message is its
 * Provisional title, and a Title model request replaces it while that message is less than a day
 * old. A discovered Session still titled "New session", listed before its first message was
 * written or by a version that did not find it, takes its title from the file on a later pass.
 */

const logger = createLogger('pi-session-discovery-titles')

/** Bounds the Sessions one pass titles; the rest wait for the next pass. */
const MAX_TITLED_PER_PASS = 100

/**
 * Sessions this Host already asked a title for. A request that ends without a title, as when the
 * Title model is Off, leaves the Provisional title; it is not asked again until a Host restart.
 */
const requestedTitles = new Set<SessionId>()

/** Whether a Title model request is owed: the first user message is recent enough. */
export function titleIsOwed(
  source: Pick<PiSessionTitleSource, 'firstUserMessage' | 'firstUserMessageAt'>,
  now: number,
) {
  return (
    source.firstUserMessage !== null &&
    source.firstUserMessageAt !== null &&
    isWithinTitleWorkWindow(source.firstUserMessageAt, now)
  )
}

/**
 * The title a discovered session is created with: its Pi `/name` when it has one, else its first
 * user message, Provisional while a Title model request is owed and kept for good otherwise.
 */
export function discoveredTitle(source: PiSessionTitleSource, now: number) {
  if (source.name) {
    return { title: boundGeneratedSessionTitle(source.name), source: 'generated' } as const
  }
  if (source.firstUserMessage) {
    return {
      title: boundGeneratedSessionTitle(buildDeterministicTitle(source.firstUserMessage)),
      source: titleIsOwed(source, now) ? 'provisional' : 'generated',
    } as const
  }
  return { title: DEFAULT_SESSION_TITLE, source: 'default' } as const
}

/** Asks the Session Host for a generated title in the background; once per Session per Host. */
export function requestDiscoveredSessionTitle(sessionId: SessionId, source: PiSessionTitleSource) {
  if (!source.firstUserMessage || requestedTitles.has(sessionId)) return
  requestedTitles.add(sessionId)
  requestInitialSessionTitle({
    sessionId,
    text: source.firstUserMessage,
    model: source.model ? SupportedModelId(source.model) : null,
  })
}

const OWED_SOURCES = ['default', 'provisional'] as const

/** A Session still titled "New session" takes its first message as title. */
function titleUntitled(
  owed: TitleOwedDiscoveredSession,
  state: SessionTitleState,
  firstUserMessage: string,
  owesRequest: boolean,
) {
  return Effect.gen(function* () {
    const title = boundGeneratedSessionTitle(buildDeterministicTitle(firstUserMessage))
    const applied = owesRequest
      ? yield* (yield* SessionProjectionRepository).assignProvisionalTitle(owed.sessionId, title)
      : yield* (yield* SessionTitleRepository).applyGenerated({
          sessionId: owed.sessionId,
          expected: { title: state.title, sources: OWED_SOURCES },
          title,
          needsRefinement: false,
        })
    if (applied) publishTitleChanged(owed.sessionId)
    return applied
  })
}

function titleFromFile(
  owed: TitleOwedDiscoveredSession,
  source: PiSessionTitleSource,
  now: number,
) {
  return Effect.gen(function* () {
    const titles = yield* SessionTitleRepository
    const state = yield* titles.getState(owed.sessionId)
    if (!state || (state.source !== 'default' && state.source !== 'provisional')) return
    const expected = { title: state.title, sources: OWED_SOURCES }
    if (source.name) {
      const applied = yield* titles.applyGenerated({
        sessionId: owed.sessionId,
        expected,
        title: boundGeneratedSessionTitle(source.name),
        needsRefinement: false,
      })
      if (applied) publishTitleChanged(owed.sessionId)
      return
    }
    if (!source.firstUserMessage) return
    const owesRequest = titleIsOwed(source, now)
    if (state.source === 'default') {
      const applied = yield* titleUntitled(owed, state, source.firstUserMessage, owesRequest)
      if (applied && owesRequest) requestDiscoveredSessionTitle(owed.sessionId, source)
      return
    }
    if (owesRequest) {
      requestDiscoveredSessionTitle(owed.sessionId, source)
      return
    }
    // Its first message is past the title-work window: the Provisional title is kept for good.
    yield* titles.applyGenerated({
      sessionId: owed.sessionId,
      expected,
      title: state.title,
      needsRefinement: false,
    })
  })
}

/**
 * Titles the discovered Sessions whose title is still owed: those without one, and those whose
 * Provisional title this Host has not asked a Title model for yet, as after a restart. Never
 * fails; one Session that cannot be titled does not stop the others.
 */
export function titleDiscoveredSessions(now: number) {
  return Effect.gen(function* () {
    // Outside the Session Host's runtime there is no title store, and nothing to title.
    const titles = yield* Effect.serviceOption(SessionTitleRepository)
    if (Option.isNone(titles)) return
    const repository = yield* PiSessionDiscoveryRepository
    const files = yield* PiSessionFiles
    const owed = yield* repository.listTitleOwedDiscoveredSessions({
      activeAfter: now - TITLE_WORK_WINDOW_MS,
      limit: MAX_TITLED_PER_PASS,
    })
    for (const session of owed) {
      if (session.titleSource === 'provisional' && requestedTitles.has(session.sessionId)) continue
      const source = yield* files.titleSource(session.piSessionFile)
      if (!source) continue
      yield* titleFromFile(session, source, now).pipe(
        Effect.provideService(SessionTitleRepository, titles.value),
        Effect.catchAllCause((cause) =>
          Effect.sync(() => {
            logger.warn('Could not title a discovered Pi session', {
              sessionId: session.sessionId,
              error: formatErrorMessage(Cause.squash(cause)),
            })
          }),
        ),
      )
    }
  }).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        logger.warn('Could not title discovered Pi sessions', {
          error: formatErrorMessage(Cause.squash(cause)),
        })
      }),
    ),
  )
}
