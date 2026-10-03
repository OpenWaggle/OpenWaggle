import type { SessionThinkingLevelChange } from '@shared/types/session'
import { THINKING_LEVELS, type ThinkingLevel } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { describeError } from '../error-description'
import { createLogger } from '../logger'
import { SessionSettingsRepository } from '../ports/session-settings-repository'
import { ThinkingLevelDefaultService } from '../ports/thinking-level-default-service'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import {
  invalid,
  requireArgCount,
  validateOptionalModel,
  validateSessionId,
} from './host-ui-session-operation-validation'

const TWO_ARGUMENTS = 2
const logger = createLogger('host-ui-session-settings')

function validateThinkingLevel(value: unknown): Effect.Effect<ThinkingLevel, Error> {
  const level = THINKING_LEVELS.find((candidate) => candidate === value)
  return level
    ? Effect.succeed(level)
    : invalid(`Thinking level must be one of ${THINKING_LEVELS.join(', ')}.`)
}

/**
 * Switches the durable model of an existing Session.
 *
 * Every Run resolves its model from the Session's execution profile when it starts, and the model
 * changes only while the Session has no active Run (starting, active, or stopping), so it never
 * reaches a Run in flight. It applies to the next Run, whether that Run comes from the composer, a
 * queued Follow-up, or another Session Control caller. Classic and Waggle Runs share this rule.
 * The per-project preferred model for new Sessions is deliberately not touched.
 */
export function setSessionModel(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, TWO_ARGUMENTS)
    const sessionId = yield* validateSessionId(args[0])
    const model = yield* validateOptionalModel(args[1])
    if (!model) return yield* invalid('Session model is required.')
    const change = yield* (yield* SessionSettingsRepository).setModel(sessionId, model)
    if (!change.changed) {
      return yield* invalid(
        change.code === 'session_run_active'
          ? 'session_run_active: The Session model can change only while no Run is active.'
          : 'Session has no execution profile whose model can be switched.',
      )
    }
    publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
  })
}

/**
 * Sets a Session's thinking level as the desktop user. Like the model, it changes only while the
 * Session has no active Run, and never changes any other Session. As with Pi's
 * `setThinkingLevel(level, { persist: true })`, the desktop user's choice also becomes Pi's global
 * default, which new Sessions start from.
 *
 * The Session change is committed and announced before the default is written. Failing to write
 * the default is logged and never reported as a failed Session change: the Session already uses
 * the new level, and only Sessions created later would start elsewhere.
 */
export function setSessionThinkingLevel(
  args: readonly unknown[],
): Effect.Effect<
  SessionThinkingLevelChange,
  unknown,
  SessionSettingsRepository | ThinkingLevelDefaultService
> {
  return Effect.gen(function* () {
    yield* requireArgCount(args, TWO_ARGUMENTS)
    const sessionId = yield* validateSessionId(args[0])
    const level = yield* validateThinkingLevel(args[1])
    const change = yield* (yield* SessionSettingsRepository).setThinkingLevel(sessionId, level)
    if (!change.changed) return change
    publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
    yield* setGlobalDefaultThinkingLevel(level).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          logger.warn("Set the Session thinking level but could not make it Pi's default", {
            sessionId,
            level,
            error: describeError(error),
          })
        }),
      ),
    )
    return change
  })
}

/**
 * Persists the desktop user's pick as Pi's global default and tells every window, so each draft
 * picker shows where the next new Session starts.
 */
function setGlobalDefaultThinkingLevel(level: ThinkingLevel) {
  return Effect.gen(function* () {
    yield* (yield* ThinkingLevelDefaultService).setDefault(level)
    publishSessionHostEvent({ kind: 'default-thinking-level-changed', level })
  })
}

/**
 * Pi's global default thinking level, where every new Session starts. A project-level Pi
 * `defaultThinkingLevel` is never used.
 */
export function getDefaultThinkingLevel(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 0)
    return yield* (yield* ThinkingLevelDefaultService).getDefault()
  })
}

/**
 * Sets Pi's global default thinking level without a Session: the desktop user's pick in a new
 * Session's composer before that Session exists, which the new Session then starts from.
 */
export function setDefaultThinkingLevel(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    const level = yield* validateThinkingLevel(args[0])
    yield* setGlobalDefaultThinkingLevel(level)
  })
}
