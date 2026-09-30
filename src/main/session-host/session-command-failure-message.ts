import * as Cause from 'effect/Cause'
import * as Runtime from 'effect/Runtime'
import { LocalSessionAuthenticationError, LocalSessionCommandAuthorizationError } from '../errors'
import { unwrapFiberFailure, userFacingErrorDetail } from '../utils/describe-error'
import { describeLocalSessionServerError } from './local-session-server-frame'

const AUTHORIZATION_REASONS = {
  capability_denied: 'the caller lacks a Session capability this operation requires',
  target_scope_denied:
    'the target Session or project is outside the authorized scope of this caller',
  authorization_ceiling_exceeded: "the requested authorization exceeds the caller's ceiling",
  profile_not_found: 'the caller profile no longer exists',
  profile_revoked: 'the caller profile was revoked',
} satisfies Record<LocalSessionCommandAuthorizationError['code'], string>

const CANCELLED_MESSAGE = 'Session command was cancelled.'

/**
 * One text for an authentication error that reaches a command path. Naming the code would tell a
 * caller whether a profile name exists or was revoked.
 */
export const LOCAL_SESSION_AUTHENTICATION_FAILED_MESSAGE = 'Local Session authentication failed.'

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

function describeAuthorizationFailure(failure: LocalSessionCommandAuthorizationError) {
  const missing = failure.missing ?? []
  const detail = missing.length > 0 ? ` Missing capabilities: ${missing.join(', ')}.` : ''
  return `Session command refused (${failure.code}): ${AUTHORIZATION_REASONS[failure.code]}.${detail}`
}

/**
 * Turn a Session command failure into a message an agent or CLI user can act on.
 *
 * Effect renders a tagged error without a `message` field as "An error has occurred", which hid
 * every authorization refusal from the Sessions tool. Authorization refusals name their code,
 * reason, and missing capabilities; a cancelled command says so; anything else is described by
 * `describeLocalSessionServerError`, which shows only identifying fields of a cause. Every text
 * except the fixed messages is redacted and bounded, because Sessions tool results go into
 * provider transcripts. The Sessions tool and the Host's command error frames both use it.
 */
export function sessionCommandFailureMessage(error: unknown): string {
  if (isInterruptedOnly(error)) return CANCELLED_MESSAGE
  const failure = unwrapFiberFailure(error)
  if (isAuthenticationFailure(failure)) return LOCAL_SESSION_AUTHENTICATION_FAILED_MESSAGE
  if (failure instanceof LocalSessionCommandAuthorizationError) {
    return describeAuthorizationFailure(failure)
  }
  return userFacingErrorDetail(describeLocalSessionServerError(error))
}
