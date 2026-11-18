import {
  LOCAL_SESSION_PROFILE_SCOPE_ENTRY_LIMIT,
  LOCAL_SESSION_PROFILE_SCOPE_VALUE_MAX_LENGTH,
} from '@shared/types/local-session-profile'
import { LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION } from '@shared/types/local-session-profile-management'
import { SESSION_CAPABILITIES } from '@shared/types/session-capability'
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

  it.each(['', '   ', ' worker', 'worker ', '\tworker'])(
    'requires profile names to be nonblank and trimmed: %j',
    (name) => {
      expect(() =>
        decodeLocalSessionProfileManagementRequest(
          request({ operation: 'create', name, credential: 'A'.repeat(43), ...policy }),
        ),
      ).toThrow()
      expect(() =>
        decodeLocalSessionProfileManagementRequest(
          request({ operation: 'revoke', profileName: name }),
        ),
      ).toThrow()
    },
  )

  it('bounds profile scope arrays and values at the management boundary', () => {
    const boundaryPaths = Array.from(
      { length: LOCAL_SESSION_PROFILE_SCOPE_ENTRY_LIMIT },
      () => '/workspace',
    )
    expect(() =>
      decodeLocalSessionProfileManagementRequest(
        request({
          operation: 'update',
          profileName: 'worker',
          ...policy,
          scope: { projectPaths: boundaryPaths },
        }),
      ),
    ).not.toThrow()
    expect(() =>
      decodeLocalSessionProfileManagementRequest(
        request({
          operation: 'update',
          profileName: 'worker',
          ...policy,
          scope: { projectPaths: [...boundaryPaths, '/overflow'] },
        }),
      ),
    ).toThrow()
    expect(() =>
      decodeLocalSessionProfileManagementRequest(
        request({
          operation: 'update',
          profileName: 'worker',
          ...policy,
          scope: { projectPaths: ['p'.repeat(LOCAL_SESSION_PROFILE_SCOPE_VALUE_MAX_LENGTH + 1)] },
        }),
      ),
    ).toThrow()
  })

  it('bounds repeated capabilities at the management boundary', () => {
    const boundaryCapabilities = Array.from(
      { length: SESSION_CAPABILITIES.length },
      () => SESSION_CAPABILITIES[0],
    )
    expect(() =>
      decodeLocalSessionProfileManagementRequest(
        request({
          operation: 'update',
          profileName: 'worker',
          ...policy,
          capabilities: boundaryCapabilities,
        }),
      ),
    ).not.toThrow()
    expect(() =>
      decodeLocalSessionProfileManagementRequest(
        request({
          operation: 'update',
          profileName: 'worker',
          ...policy,
          capabilities: [...boundaryCapabilities, SESSION_CAPABILITIES[0]],
        }),
      ),
    ).toThrow()
  })
})
