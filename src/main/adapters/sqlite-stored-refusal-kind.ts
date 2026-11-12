import {
  isSessionHostRefusalCode,
  SESSION_HOST_REFUSAL_KINDS,
  sessionHostRefusal,
} from '@shared/domain/session-host-refusals'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A refusal stored for replay before 1.0.0-rc.1 has no `kind` (ADR 0063). Its replay takes the
 * kind the refusal table gives its code now, and `conflict` for a code the table no longer has.
 */
export function withStoredRefusalKind(value: unknown): unknown {
  if (
    !isRecord(value) ||
    value.effect !== 'rejected' ||
    'kind' in value ||
    typeof value.code !== 'string'
  ) {
    return value
  }
  return {
    ...value,
    kind: isSessionHostRefusalCode(value.code)
      ? SESSION_HOST_REFUSAL_KINDS[value.code]
      : 'conflict',
  }
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
export function withStoredProfileRefusalKind(value: unknown): unknown {
  const outcome = withStoredRefusalKind(value)
  if (typeof outcome !== 'object' || outcome === null) return outcome
  if (Reflect.get(outcome, 'effect') !== 'rejected') return outcome
  const code: unknown = Reflect.get(outcome, 'code')
  const current =
    code === 'profile_revoked' || code === 'profile_not_found'
      ? STORED_TARGET_PROFILE_CODES.get(code)
      : undefined
  return current ? { ...outcome, ...sessionHostRefusal(current) } : outcome
}
