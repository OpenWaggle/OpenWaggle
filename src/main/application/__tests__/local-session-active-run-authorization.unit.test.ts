import fs from 'node:fs'
import os from 'node:os'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { LocalSessionProfileRepository } from '../../ports/local-session-profile-repository'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { authorizeLocalSessionActiveRun } from '../local-session-command-authorization'

const ALLOWED_PROJECT = fs.realpathSync(os.tmpdir())
const OTHER_PROJECT = '/'

function authorizationLayer(caller: LocalSessionCallerIdentity) {
  const authority = caller.profileAuthority
  return Layer.mergeAll(
    Layer.succeed(SessionAuthorizationTargetRepository, {
      resolve: (sessionId) =>
        Effect.succeed({
          sessionId,
          projectPath: sessionId === 'allowed' ? ALLOWED_PROJECT : OTHER_PROJECT,
          hiveRootSessionId: sessionId,
          authorizationCeiling: 'yolo' as const,
        }),
      resolveDelegation: () => Effect.die('Delegations are not used in this test.'),
      listLiveDerivedAuthorities: () => Effect.succeed([]),
    }),
    Layer.succeed(LocalSessionProfileRepository, {
      list: () => Effect.succeed([]),
      findForAuthentication: () => Effect.succeed(null),
      findById: () =>
        Effect.succeed(
          authority
            ? {
                id: authority.profileId,
                name: authority.profileName,
                credentialVerifier: 'unused',
                capabilities: authority.capabilities,
                scope: authority.scope,
                authorizationCeiling: authority.authorizationCeiling,
                revokedAt: null,
              }
            : null,
        ),
      recordAuthentication: () => Effect.void,
      executeManagement: () => Effect.die('Profile management is not used in this test.'),
    }),
  )
}

function restrictedCaller(capabilities: readonly ('sessions:discover' | 'sessions:read')[]) {
  return {
    callerId: 'profile:reader',
    profileAuthority: {
      profileId: 'reader',
      profileName: 'reader',
      capabilities,
      scope: { projectPaths: [ALLOWED_PROJECT] },
      authorizationCeiling: 'ask-for-approval' as const,
    },
  } satisfies LocalSessionCallerIdentity
}

describe('local Session active Run authorization', () => {
  it('requires read capability and target scope before returning buffered transcript parts', async () => {
    const discoverOnly = restrictedCaller(['sessions:discover'])
    const reader = restrictedCaller(['sessions:read'])

    await expect(
      Effect.runPromise(
        authorizeLocalSessionActiveRun(discoverOnly, 'allowed').pipe(
          Effect.provide(authorizationLayer(discoverOnly)),
        ),
      ),
    ).resolves.toBe(false)
    await expect(
      Effect.runPromise(
        authorizeLocalSessionActiveRun(reader, 'outside').pipe(
          Effect.provide(authorizationLayer(reader)),
        ),
      ),
    ).resolves.toBe(false)
    await expect(
      Effect.runPromise(
        authorizeLocalSessionActiveRun(reader, 'allowed').pipe(
          Effect.provide(authorizationLayer(reader)),
        ),
      ),
    ).resolves.toBe(true)
  })
})
