import { LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION } from '@shared/types/local-session-profile-management'
import { describe, expect, it } from 'vitest'
import { decodeLocalSessionProfileManagementRequest } from '../local-session-profile-management'

function request(command: unknown) {
  return {
    contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
    requestId: 'request-1',
    idempotencyKey: 'operation-1',
    command,
  }
}

const policy = {
  capabilities: ['sessions:read'],
  scope: { sessionIds: ['session-1'] },
  authorizationCeiling: 'ask-for-approval',
}

describe('Local Session profile management schema', () => {
  it('accepts the generated 43-character base64url credential format', () => {
    expect(
      decodeLocalSessionProfileManagementRequest(
        request({ operation: 'create', name: 'worker', credential: 'A'.repeat(43), ...policy }),
      ),
    ).toMatchObject({ command: { operation: 'create', name: 'worker' } })
  })

  it.each(['', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}+`, `${'A'.repeat(42)}/`])(
    'rejects a malformed credential without starting verifier work',
    (credential) => {
      expect(() =>
        decodeLocalSessionProfileManagementRequest(
          request({ operation: 'rotate', profileName: 'worker', credential }),
        ),
      ).toThrow()
    },
  )

  it('bounds profile names in create and target operations', () => {
    const oversizedName = 'p'.repeat(129)
    expect(() =>
      decodeLocalSessionProfileManagementRequest(
        request({
          operation: 'create',
          name: oversizedName,
          credential: 'A'.repeat(43),
          ...policy,
        }),
      ),
    ).toThrow()
    expect(() =>
      decodeLocalSessionProfileManagementRequest(
        request({ operation: 'revoke', profileName: oversizedName }),
      ),
    ).toThrow()
  })
})
