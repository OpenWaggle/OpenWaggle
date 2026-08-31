import fs from 'node:fs'
import os from 'node:os'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { LocalSessionProfileRepository } from '../../ports/local-session-profile-repository'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { authorizeLocalSessionEvent } from '../local-session-event-authorization'

const ALLOWED_PROJECT = fs.realpathSync(os.tmpdir())

describe('local Session event authorization admission snapshots', () => {
  it('does not recompute the admission snapshot for each authorized event', async () => {
    const caller: LocalSessionCallerIdentity = {
      callerId: 'profile:worker-client',
      profileAuthority: {
        profileId: 'worker-client',
        profileName: 'worker-client',
        capabilities: ['sessions:discover'],
        scope: { projectPaths: [ALLOWED_PROJECT] },
        authorizationCeiling: 'ask-for-approval',
      },
    }
    const listAuthorizedSessionIds = vi.fn(() => Effect.succeed(['session-worker']))
    const layer = Layer.mergeAll(
      Layer.succeed(SessionAuthorizationTargetRepository, {
        resolve: (sessionId) =>
          Effect.succeed({
            sessionId,
            projectPath: ALLOWED_PROJECT,
            hiveRootSessionId: 'session-queen',
            authorizationCeiling: 'yolo' as const,
          }),
        resolveDelegation: (delegationId) =>
          Effect.succeed({
            sessionId: `worker-for-${delegationId}`,
            projectPath: ALLOWED_PROJECT,
            hiveRootSessionId: 'session-queen',
            authorizationCeiling: 'yolo' as const,
          }),
        listLiveDerivedAuthorities: () => Effect.succeed([]),
        listAuthorizedSessionIds,
      }),
      Layer.succeed(LocalSessionProfileRepository, {
        list: () => Effect.succeed([]),
        findForAuthentication: () => Effect.succeed(null),
        findById: () =>
          Effect.succeed({
            id: 'worker-client',
            name: 'worker-client',
            credentialVerifier: 'unused',
            capabilities: ['sessions:discover'],
            scope: { projectPaths: [ALLOWED_PROJECT] },
            authorizationCeiling: 'ask-for-approval' as const,
            revokedAt: null,
          }),
        recordAuthentication: () => Effect.void,
        executeManagement: () => Effect.die('Profile management is not used in this test.'),
      }),
    )

    await expect(
      Effect.runPromise(
        authorizeLocalSessionEvent(caller, {
          cursor: { hostInstanceId: 'host', sequence: 1 },
          timestamp: 1,
          payload: {
            kind: 'session-state-changed',
            sessionId: 'session-worker',
            stateRevision: 2,
            operation: 'message',
          },
        }).pipe(Effect.provide(layer)),
      ),
    ).resolves.toBe(true)
    expect(listAuthorizedSessionIds).not.toHaveBeenCalled()
  })
})
