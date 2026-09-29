import * as Cause from 'effect/Cause'
import * as Runtime from 'effect/Runtime'
import { LocalSessionCommandAuthorizationError } from '../errors'
import { describeError, userFacingErrorDetail } from '../utils/describe-error'

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

function unwrapFailure(error: unknown): unknown {
  return Runtime.isFiberFailure(error) ? Cause.squash(error[Runtime.FiberFailureCauseId]) : error
}

type AuthorizationCode = keyof typeof AUTHORIZATION_REASONS

function isAuthorizationCode(value: unknown): value is AuthorizationCode {
  return typeof value === 'string' && Object.hasOwn(AUTHORIZATION_REASONS, value)
}

function missingCapabilities(failure: object) {
  const missing: unknown = Reflect.get(failure, 'missing')
  return Array.isArray(missing)
    ? missing.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function describeAuthorizationFailure(code: AuthorizationCode, missing: readonly string[]) {
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
 * operation, and cause chain, redacted and bounded like any other detail that leaves the Host.
 */
export function sessionCommandFailureMessage(error: unknown): string {
  const failure = unwrapFailure(error)
  if (failure instanceof LocalSessionCommandAuthorizationError) {
    return describeAuthorizationFailure(failure.code, failure.missing ?? [])
  }
  if (hasUsefulMessage(failure)) return failure.message
  if (typeof failure !== 'object' || failure === null) return String(failure)
  // A refusal rebuilt from a protocol frame keeps its code but not its class.
  const code: unknown = Reflect.get(failure, 'code')
  if (isAuthorizationCode(code)) {
    return describeAuthorizationFailure(code, missingCapabilities(failure))
  }
  return userFacingErrorDetail(describeError(failure))
}
