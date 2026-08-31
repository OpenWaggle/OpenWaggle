import fs from 'node:fs'
import os from 'node:os'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { LocalSessionProfileRepository } from '../../ports/local-session-profile-repository'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { refreshNamedProfileCaller } from '../local-session-derived-authority'
import { authorizeLocalSessionEvent } from '../local-session-event-authorization'

const ALLOWED_PROJECT = fs.realpathSync(os.tmpdir())

describe('local Session event authorization admission snapshots', () => {
  it('performs no repository reads across repeated authorized events', async () => {
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
    const resolve = vi.fn((sessionId: string) =>
      Effect.succeed({
        sessionId,
        projectPath: ALLOWED_PROJECT,
        hiveRootSessionId: 'session-queen',
        authorizationCeiling: 'yolo' as const,
      }),
    )
    const listLiveDerivedAuthorities = vi.fn(() =>
      Effect.succeed([
        {
          sessionId: 'session-derived',
          capabilities: ['sessions:discover'] as const,
          authorizationCeiling: 'ask-for-approval' as const,
        },
      ]),
    )
    const listAuthorizedSessionIds = vi.fn(() => Effect.succeed(['session-worker']))
    const findById = vi.fn(() =>
      Effect.succeed({
        id: 'worker-client',
        name: 'worker-client',
        credentialVerifier: 'unused',
        capabilities: ['sessions:discover'] as const,
        scope: { projectPaths: [ALLOWED_PROJECT] },
        authorizationCeiling: 'ask-for-approval' as const,
        revokedAt: null,
      }),
    )
    const layer = Layer.mergeAll(
      Layer.succeed(SessionAuthorizationTargetRepository, {
        resolve,
        resolveDelegation: (delegationId) =>
          Effect.succeed({
            sessionId: `worker-for-${delegationId}`,
            projectPath: ALLOWED_PROJECT,
            hiveRootSessionId: 'session-queen',
            authorizationCeiling: 'yolo' as const,
          }),
        listLiveDerivedAuthorities,
        listAuthorizedSessionIds,
      }),
      Layer.succeed(LocalSessionProfileRepository, {
        list: () => Effect.succeed([]),
        findForAuthentication: () => Effect.succeed(null),
        findById,
        recordAuthentication: () => Effect.void,
        executeManagement: () => Effect.die('Profile management is not used in this test.'),
      }),
    )

    const refreshedCaller = await Effect.runPromise(
      refreshNamedProfileCaller(caller).pipe(Effect.provide(layer)),
    )
    expect(refreshedCaller.eventAdmissionSessionIds).toEqual(['session-worker'])
    expect(refreshedCaller.derivedSessionAuthorities).toEqual([
      expect.objectContaining({ sessionId: 'session-derived' }),
    ])
    expect(findById).toHaveBeenCalledOnce()
    expect(listLiveDerivedAuthorities).toHaveBeenCalledOnce()
    expect(listAuthorizedSessionIds).toHaveBeenCalledOnce()
    resolve.mockClear()
    findById.mockClear()
    listLiveDerivedAuthorities.mockClear()
    listAuthorizedSessionIds.mockClear()

    const results = await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: 100 }, (_, index) => index + 1),
        (sequence) =>
          authorizeLocalSessionEvent(refreshedCaller, {
            cursor: { hostInstanceId: 'host', sequence },
            timestamp: sequence,
            payload: {
              kind: 'session-state-changed',
              sessionId: 'session-worker',
              stateRevision: sequence,
              operation: 'message',
            },
          }),
      ).pipe(Effect.provide(layer)),
    )

    expect(results).toEqual(Array.from({ length: 100 }, () => true))
    expect(resolve).not.toHaveBeenCalled()
    expect(listLiveDerivedAuthorities).not.toHaveBeenCalled()
    expect(listAuthorizedSessionIds).not.toHaveBeenCalled()
    expect(findById).not.toHaveBeenCalled()
  })
})
