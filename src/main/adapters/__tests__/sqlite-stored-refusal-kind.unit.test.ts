import { describe, expect, it } from 'vitest'
import { decodeStoredSessionControlMutationOutcome } from '../sqlite-session-control-outcome-decoder'
import { withStoredProfileRefusalKind, withStoredRefusalKind } from '../sqlite-stored-refusal-kind'

describe('refusals stored before refusal kinds (ADR 0063)', () => {
  it('replays a stored refusal with the kind its code has now', () => {
    expect(
      decodeStoredSessionControlMutationOutcome(
        JSON.stringify({
          operation: 'steer',
          effect: 'rejected',
          sessionId: 'session-1',
          code: 'target_scope_denied',
        }),
      ),
    ).toEqual({
      operation: 'steer',
      effect: 'rejected',
      sessionId: 'session-1',
      code: 'target_scope_denied',
      kind: 'authorization',
    })
  })

  it('replays a code the table no longer has as a conflict, and leaves the rest alone', () => {
    expect(withStoredRefusalKind({ effect: 'rejected', code: 'retired_code' })).toEqual({
      effect: 'rejected',
      code: 'retired_code',
      kind: 'conflict',
    })
    const kinded = { effect: 'rejected', code: 'run_changed', kind: 'conflict' }
    expect(withStoredRefusalKind(kinded)).toBe(kinded)
    const accepted = { effect: 'queued-follow-up', code: 'x' }
    expect(withStoredRefusalKind(accepted)).toBe(accepted)
  })

  it('replays a profile change refused with the caller-profile codes under the target codes', () => {
    expect(
      ['profile_revoked', 'profile_not_found', 'profile_name_exists'].map((code) =>
        withStoredProfileRefusalKind({ operation: 'update', effect: 'rejected', code }),
      ),
    ).toEqual([
      { operation: 'update', effect: 'rejected', code: 'target_profile_revoked', kind: 'conflict' },
      {
        operation: 'update',
        effect: 'rejected',
        code: 'target_profile_not_found',
        kind: 'not_found',
      },
      { operation: 'update', effect: 'rejected', code: 'profile_name_exists', kind: 'conflict' },
    ])
  })
})
