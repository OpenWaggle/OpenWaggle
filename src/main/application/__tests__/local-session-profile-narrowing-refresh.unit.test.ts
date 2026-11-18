import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import {
  type LocalSessionProfileAuthenticationRecord,
  LocalSessionProfileRepository,
} from '../../ports/local-session-profile-repository'
import { refreshNamedProfileCaller } from '../local-session-derived-authority'
import { repositoryLayer } from './local-session-profile-narrowing.test-support'

describe('refreshNamedProfileCaller with an MCP narrowing', () => {
  const storedProfile: LocalSessionProfileAuthenticationRecord = {
    id: 'reviewer-id',
    name: 'reviewer',
    credentialVerifier: 'verifier',
    capabilities: ['sessions:discover', 'sessions:read'],
    scope: { all: true },
    authorizationCeiling: 'yolo',
    revokedAt: null,
  }

  function refresh(profile: LocalSessionProfileAuthenticationRecord | null) {
    const placeholder: LocalSessionCallerIdentity = {
      callerId: 'profile:reviewer-id',
      baseProfileScope: {},
      profileAuthority: {
        profileId: 'reviewer-id',
        profileName: 'reviewer',
        capabilities: [],
        scope: {},
        authorizationCeiling: 'yolo',
      },
      profileNarrowing: {
        profileId: 'mcp:reviewer',
        profileName: 'reviewer',
        capabilities: ['sessions:discover'],
        scope: { workspaceRoots: ['/repo-b'] },
        authorizationCeiling: 'yolo',
      },
    }
    const profiles = Layer.succeed(LocalSessionProfileRepository, {
      list: () => Effect.succeed([]),
      findForAuthentication: () => Effect.succeed(profile),
      findById: () => Effect.succeed(profile),
      recordAuthentication: () => Effect.void,
      executeManagement: () => Effect.die('not used'),
    })
    return Effect.runPromise(
      refreshNamedProfileCaller(placeholder).pipe(
        Effect.either,
        Effect.provide(Layer.mergeAll(profiles, repositoryLayer)),
      ),
    )
  }

  it('replaces the placeholder with the live profile intersected with the server grants', async () => {
    const result = await refresh(storedProfile)
    if (result._tag === 'Left') throw result.left

    expect(result.right.profileAuthority).toEqual({
      profileId: 'reviewer-id',
      profileName: 'reviewer',
      capabilities: ['sessions:discover'],
      scope: { projectPaths: ['/repo-b'] },
      authorizationCeiling: 'yolo',
    })
    expect(result.right.eventAdmissionSessionIds).toEqual(['b-root'])
  })

  it('fails closed for a profile revoked or deleted since the server started', async () => {
    const revoked = await refresh({ ...storedProfile, revokedAt: 1 })
    const unknown = await refresh(null)

    expect(revoked).toMatchObject({ _tag: 'Left', left: { code: 'profile_revoked' } })
    expect(unknown).toMatchObject({ _tag: 'Left', left: { code: 'profile_not_found' } })
  })
})
