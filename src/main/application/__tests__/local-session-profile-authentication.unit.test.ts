import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { LocalSessionCredentialVerifier } from '../../ports/local-session-credential-verifier'
import {
  type LocalSessionProfileAuthenticationRecord,
  LocalSessionProfileRepository,
} from '../../ports/local-session-profile-repository'
import { authenticateLocalSessionProfile } from '../local-session-profile-authentication'

const activeProfile: LocalSessionProfileAuthenticationRecord = {
  id: 'profile-review',
  name: 'review-bot',
  credentialVerifier: 'stored-verifier',
  capabilities: ['sessions:read', 'sessions:message'],
  scope: { projectPaths: ['/project'] },
  authorizationCeiling: 'ask-for-approval' as const,
  revokedAt: null,
}

function layer(input: { readonly accepted: boolean; readonly revokedAt?: number }) {
  const audit: boolean[] = []
  return {
    audit,
    layer: Layer.mergeAll(
      Layer.succeed(LocalSessionCredentialVerifier, {
        verify: () => Effect.succeed(input.accepted),
      }),
      Layer.succeed(LocalSessionProfileRepository, {
        list: () => Effect.succeed([]),
        findForAuthentication: () =>
          Effect.succeed({
            ...activeProfile,
            revokedAt: input.revokedAt ?? activeProfile.revokedAt,
          }),
        findById: () => Effect.succeed(null),
        recordAuthentication: ({ accepted }) => Effect.sync(() => audit.push(accepted)),
        executeManagement: () => Effect.die('Profile management is not used in this test.'),
      }),
    ),
  }
}

describe('Local Session profile authentication', () => {
  it('returns the persisted non-escalating authority after verification', async () => {
    const test = layer({ accepted: true })
    const caller = await Effect.runPromise(
      authenticateLocalSessionProfile({
        profile: 'review-bot',
        credential: 'secret',
        clientKind: 'mcp',
        clientVersion: 'test',
        now: 2000,
      }).pipe(Effect.provide(test.layer)),
    )

    expect(caller).toEqual({
      callerId: 'profile:profile-review',
      profileAuthority: {
        profileId: 'profile-review',
        profileName: 'review-bot',
        capabilities: ['sessions:read', 'sessions:message'],
        scope: { projectPaths: ['/project'] },
        authorizationCeiling: 'ask-for-approval',
      },
    })
    expect(test.audit).toEqual([true])
  })

  it('records and rejects a bad credential or a revoked profile', async () => {
    const rejected = layer({ accepted: false })
    const revoked = layer({ accepted: true, revokedAt: 1000 })

    const credentialError = await Effect.runPromise(
      authenticateLocalSessionProfile({
        profile: 'review-bot',
        credential: 'bad',
        clientKind: 'cli',
        clientVersion: 'test',
        now: 2000,
      })
        .pipe(Effect.flip)
        .pipe(Effect.provide(rejected.layer)),
    )
    const revokedError = await Effect.runPromise(
      authenticateLocalSessionProfile({
        profile: 'review-bot',
        credential: 'secret',
        clientKind: 'cli',
        clientVersion: 'test',
        now: 2000,
      })
        .pipe(Effect.flip)
        .pipe(Effect.provide(revoked.layer)),
    )

    expect(credentialError).toMatchObject({ code: 'credential_rejected' })
    expect(revokedError).toMatchObject({ code: 'profile_revoked' })
    expect(rejected.audit).toEqual([false])
    expect(revoked.audit).toEqual([false])
  })
})
