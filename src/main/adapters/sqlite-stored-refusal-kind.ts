import {
  isSessionHostRefusalCode,
  SESSION_HOST_REFUSAL_KINDS,
  sessionHostRefusal,
} from '@shared/domain/session-host-refusals'
import { isObjectValue, uncheckedFields } from '@shared/utils/object-shape'

/** The fields of a stored replay outcome its refusal migration reads; it keeps every other one. */
interface StoredOutcome {
  readonly effect: string
  readonly code: string
  readonly kind: string
}

/**
 * A refusal stored for replay before 1.0.0-rc.1 has no `kind` (ADR 0063). Its replay takes the
 * kind the refusal table gives its code now, and `conflict` for a code the table no longer has.
 */
export function withStoredRefusalKind(value: unknown) {
  if (!isObjectValue(value) || 'kind' in value) return value
  const { effect, code } = uncheckedFields<StoredOutcome>(value)
  if (effect !== 'rejected' || typeof code !== 'string') {
    const result: unknown = value
    return result
  }
  const result: unknown = {
    ...value,
    kind: isSessionHostRefusalCode(code) ? SESSION_HOST_REFUSAL_KINDS[code] : 'conflict',
  }
  return result
}

/** The codes a change to a missing or revoked profile had before 1.0.0-rc.1 (ADR 0063). */
const STORED_TARGET_PROFILE_CODES = new Map([
  ['profile_revoked', 'target_profile_revoked'],
  ['profile_not_found', 'target_profile_not_found'],
] as const)

/**
 * Before 1.0.0-rc.1 a change to a missing or revoked profile was refused with the code the
 * caller's own profile has. Its replay takes the code and kind it has now (ADR 0063).
 */
export function withStoredProfileRefusalKind(value: unknown) {
  const outcome = withStoredRefusalKind(value)
  if (typeof outcome !== 'object' || outcome === null) return outcome
  const { effect, code } = uncheckedFields<StoredOutcome>(outcome)
  if (effect !== 'rejected') {
    const result: unknown = outcome
    return result
  }
  const current =
    code === 'profile_revoked' || code === 'profile_not_found'
      ? STORED_TARGET_PROFILE_CODES.get(code)
      : undefined
  const result: unknown = current ? { ...outcome, ...sessionHostRefusal(current) } : outcome
  return result
}
