import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import { LocalSessionAuthenticationError } from '../errors'
import { LocalSessionCredentialVerifier } from '../ports/local-session-credential-verifier'
import { LocalSessionProfileRepository } from '../ports/local-session-profile-repository'

export interface AuthenticateLocalSessionProfileInput {
  readonly profile: string
  readonly credential: string
  readonly clientKind: string
  readonly clientVersion: string
  readonly now: number
}

export function authenticateLocalSessionProfile(
  input: AuthenticateLocalSessionProfileInput,
): Effect.Effect<
  LocalSessionCallerIdentity,
  Error,
  LocalSessionCredentialVerifier | LocalSessionProfileRepository
> {
  return Effect.gen(function* () {
    const repository = yield* LocalSessionProfileRepository
    const verifier = yield* LocalSessionCredentialVerifier
    const profile = yield* repository.findForAuthentication(input.profile)
    if (!profile) {
      return yield* Effect.fail(new LocalSessionAuthenticationError({ code: 'profile_not_found' }))
    }
    if (profile.revokedAt !== null) {
      yield* repository.recordAuthentication({
        profileId: profile.id,
        accepted: false,
        clientKind: input.clientKind,
        clientVersion: input.clientVersion,
        now: input.now,
      })
      return yield* Effect.fail(new LocalSessionAuthenticationError({ code: 'profile_revoked' }))
    }
    const accepted = yield* verifier.verify({
      credential: input.credential,
      verifier: profile.credentialVerifier,
    })
    yield* repository.recordAuthentication({
      profileId: profile.id,
      accepted,
      clientKind: input.clientKind,
      clientVersion: input.clientVersion,
      now: input.now,
    })
    if (!accepted) {
      return yield* Effect.fail(
        new LocalSessionAuthenticationError({ code: 'credential_rejected' }),
      )
    }
    return {
      callerId: `profile:${profile.id}`,
      profileAuthority: {
        profileId: profile.id,
        profileName: profile.name,
        capabilities: profile.capabilities,
        scope: profile.scope,
        authorizationCeiling: profile.authorizationCeiling,
        ...(profile.managementEnvelope ? { managementEnvelope: profile.managementEnvelope } : {}),
      },
    }
  })
}
