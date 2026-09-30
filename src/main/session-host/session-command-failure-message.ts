import * as Cause from 'effect/Cause'
import * as Runtime from 'effect/Runtime'
import { LocalSessionAuthenticationError, LocalSessionCommandAuthorizationError } from '../errors'
import { describeError, unwrapFiberFailure, userFacingErrorDetail } from '../utils/describe-error'
import { LocalSessionAuthenticationBudgetError } from './local-session-resource-policy'

/** Effect's placeholder when a failure carries no message of its own. */
const EFFECT_PLACEHOLDER_MESSAGE = 'An error has occurred'

const AUTHORIZATION_REASONS = {
  capability_denied: 'the caller lacks a Session capability this operation requires',
  target_scope_denied:
    'the target Session or project is outside the authorized scope of this caller',
  authorization_ceiling_exceeded: "the requested authorization exceeds the caller's ceiling",
  profile_not_found: 'the caller profile no longer exists',
  profile_revoked: 'the caller profile was revoked',
} satisfies Record<LocalSessionCommandAuthorizationError['code'], string>

const CANCELLED_MESSAGE = 'Session command was cancelled.'
const UNEXPECTED_FAILURE_MESSAGE =
  'Session command failed unexpectedly. The Session Host log has the details.'

/**
 * One text for every authentication failure. Naming the code would tell a client without a
 * credential whether a profile name exists or was revoked.
 */
export const LOCAL_SESSION_AUTHENTICATION_FAILED_MESSAGE =
  'Authentication with the Local Session Host failed. Check the profile name and credential.'

function isInterruptedOnly(error: unknown) {
  return (
    Runtime.isFiberFailure(error) && Cause.isInterruptedOnly(error[Runtime.FiberFailureCauseId])
  )
}

function isAuthenticationFailure(failure: unknown) {
  return (
    failure instanceof LocalSessionAuthenticationError ||
    (typeof failure === 'object' &&
      failure !== null &&
      Reflect.get(failure, '_tag') === 'LocalSessionAuthenticationError')
  )
}

function describeAuthorizationFailure(
  code: LocalSessionCommandAuthorizationError['code'],
  missing: readonly string[],
) {
  const detail = missing.length > 0 ? ` Missing capabilities: ${missing.join(', ')}.` : ''
  return `Session command refused (${code}): ${AUTHORIZATION_REASONS[code]}.${detail}`
}

function hasUsefulMessage(failure: unknown): failure is Error {
  return (
    failure instanceof Error &&
    failure.message.length > 0 &&
    failure.message !== EFFECT_PLACEHOLDER_MESSAGE
  )
}

/**
 * Turn a Session command failure into a message an agent or CLI user can act on.
 *
 * Effect renders a tagged error without a `message` field as "An error has occurred", which hid
 * every authorization refusal and preparation failure from the Sessions tool. Authorization
 * refusals name their code and reason; other message-less failures fall back to the tag,
 * operation, and cause chain. Every text that is not a fixed message is redacted and bounded,
 * because Sessions tool results go into provider transcripts.
 */
export function sessionCommandFailureMessage(error: unknown): string {
  if (isInterruptedOnly(error)) return CANCELLED_MESSAGE
  const failure = unwrapFiberFailure(error)
  if (isAuthenticationFailure(failure)) return LOCAL_SESSION_AUTHENTICATION_FAILED_MESSAGE
  if (failure instanceof LocalSessionCommandAuthorizationError) {
    return describeAuthorizationFailure(failure.code, failure.missing ?? [])
  }
  if (hasUsefulMessage(failure)) return userFacingErrorDetail(failure.message)
  if (typeof failure !== 'object' || failure === null) return userFacingErrorDetail(String(failure))
  // A bare object (for example `Effect.die({ projectPath })`) says nothing useful, and its fields
  // are Host context that the caller should not see; the Host log keeps it.
  if (!(failure instanceof Error) && Reflect.get(failure, '_tag') === undefined) {
    return UNEXPECTED_FAILURE_MESSAGE
  }
  return userFacingErrorDetail(describeError(failure, { plainObjects: 'omit' }))
}

/**
 * The message for a failed handshake. Only admission-budget refusals (throttled, aborted) keep
 * their text; every other failure, tagged or not (unknown or revoked profile, rejected credential,
 * a corrupt profile row, a repository failure), shares one message so an unauthenticated client
 * learns nothing about profiles.
 */
export function localSessionAuthenticationFailureMessage(error: unknown): string {
  const failure = unwrapFiberFailure(error)
  return failure instanceof LocalSessionAuthenticationBudgetError
    ? failure.message
    : LOCAL_SESSION_AUTHENTICATION_FAILED_MESSAGE
}
