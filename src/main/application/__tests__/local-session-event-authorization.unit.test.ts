import fs from 'node:fs'
import os from 'node:os'
import { SupportedModelId } from '@shared/types/brand'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { LocalSessionProfileRepository } from '../../ports/local-session-profile-repository'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import {
  authorizeLocalSessionEvent,
  lifecycleCallerCapabilities,
  profileAuthorityForCapabilities,
} from '../local-session-command-dispatcher'

const ALLOWED_PROJECT = fs.realpathSync(os.tmpdir())

function eventLayer(
  caller: LocalSessionCallerIdentity,
  revokedAt: number | null = null,
  derivedAuthorities: NonNullable<LocalSessionCallerIdentity['derivedSessionAuthorities']> = [],
) {
  const authority = caller.profileAuthority
  return Layer.mergeAll(
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
      listLiveDerivedAuthorities: () => Effect.succeed(derivedAuthorities),
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
                ...(authority.managementEnvelope
                  ? { managementEnvelope: authority.managementEnvelope }
                  : {}),
                revokedAt,
              }
            : null,
        ),
      recordAuthentication: () => Effect.void,
      executeManagement: () => Effect.die('Profile management is not used in this test.'),
    }),
  )
}

function restrictedCaller(
  overrides: Partial<NonNullable<LocalSessionCallerIdentity['profileAuthority']>> = {},
): LocalSessionCallerIdentity {
  return {
    callerId: 'profile:worker-client',
    profileAuthority: {
      profileId: 'worker-client',
      profileName: 'worker-client',
      capabilities: ['sessions:start'],
      scope: { projectPaths: [ALLOWED_PROJECT] },
      authorizationCeiling: 'ask-for-approval',
      ...overrides,
    },
  }
}

describe('local Session event authorization', () => {
  it('filters events by payload sensitivity, capability, and target scope', async () => {
    const stateEvent = {
      cursor: { hostInstanceId: 'host', sequence: 1 },
      timestamp: 1,
      payload: {
        kind: 'session-state-changed' as const,
        sessionId: 'session-worker',
        stateRevision: 1,
        operation: 'message',
      },
    }
    const transportEvent = {
      ...stateEvent,
      payload: {
        kind: 'session-transport' as const,
        sessionId: 'session-worker',
        event: { type: 'agent_start' as const, runId: 'run-worker', timestamp: 1 },
      },
    }
    const discoverOnly = restrictedCaller({ capabilities: ['sessions:discover'] })
    const wrongScope = restrictedCaller({
      capabilities: ['sessions:read'],
      scope: { projectPaths: ['/'] },
    })

    await expect(
      Effect.runPromise(
        authorizeLocalSessionEvent(discoverOnly, stateEvent).pipe(
          Effect.provide(eventLayer(discoverOnly)),
        ),
      ),
    ).resolves.toBe(true)
    await expect(
      Effect.runPromise(
        authorizeLocalSessionEvent(discoverOnly, transportEvent).pipe(
          Effect.provide(eventLayer(discoverOnly)),
        ),
      ),
    ).resolves.toBe(false)
    await expect(
      Effect.runPromise(
        authorizeLocalSessionEvent(wrongScope, transportEvent).pipe(
          Effect.provide(eventLayer(wrongScope)),
        ),
      ),
    ).resolves.toBe(false)
  })

  it.each([
    {
      cursor: { hostInstanceId: 'host', sequence: 1 },
      timestamp: 1,
      payload: {
        kind: 'session-waggle-transport',
        sessionId: 'session-worker',
        event: { type: 'agent_start', runId: 'run-worker', timestamp: 1 },
        meta: {
          agentIndex: 0,
          agentLabel: 'Worker',
          agentColor: 'blue',
          agentModel: SupportedModelId('provider/model'),
          turnNumber: 1,
          collaborationMode: 'sequential',
        },
      },
    },
    {
      cursor: { hostInstanceId: 'host', sequence: 2 },
      timestamp: 2,
      payload: {
        kind: 'session-waggle-turn',
        sessionId: 'session-worker',
        event: { type: 'collaboration-complete', reason: 'done', totalTurns: 1 },
      },
    },
  ] satisfies readonly SessionHostEventEnvelope[])(
    'requires sessions:read for $payload.kind content',
    async (event) => {
      const discoverOnly = restrictedCaller({ capabilities: ['sessions:discover'] })
      const reader = restrictedCaller({ capabilities: ['sessions:read'] })
      await expect(
        Effect.runPromise(
          authorizeLocalSessionEvent(discoverOnly, event).pipe(
            Effect.provide(eventLayer(discoverOnly)),
          ),
        ),
      ).resolves.toBe(false)
      await expect(
        Effect.runPromise(
          authorizeLocalSessionEvent(reader, event).pipe(Effect.provide(eventLayer(reader))),
        ),
      ).resolves.toBe(true)
    },
  )

  it('stops events after an already-connected profile is revoked', async () => {
    const caller = restrictedCaller({ capabilities: ['sessions:discover'] })
    const event = {
      cursor: { hostInstanceId: 'host', sequence: 1 },
      timestamp: 1,
      payload: {
        kind: 'session-state-changed' as const,
        sessionId: 'session-worker',
        stateRevision: 2,
        operation: 'interrupt',
      },
    }

    await expect(
      Effect.runPromise(
        authorizeLocalSessionEvent(caller, event).pipe(Effect.provide(eventLayer(caller, 2))),
      ),
    ).resolves.toBe(false)
  })

  it('does not publish global semantic readiness to restricted callers', async () => {
    const caller = restrictedCaller({ capabilities: ['sessions:discover'] })
    const event: SessionHostEventEnvelope = {
      cursor: { hostInstanceId: 'host', sequence: 1 },
      timestamp: 1,
      payload: {
        kind: 'semantic-discovery-readiness-changed',
        readiness: {
          status: 'failed',
          pendingCount: 91,
          snapshotRevision: 72,
          preparationOperationId: 'private-global-operation',
          reason: 'private-global-failure',
        },
      },
    }

    await expect(
      Effect.runPromise(
        authorizeLocalSessionEvent(caller, event).pipe(Effect.provide(eventLayer(caller))),
      ),
    ).resolves.toBe(false)
  })

  it('does not project a child into read scope without a derived read grant', async () => {
    const caller = restrictedCaller({
      capabilities: ['sessions:read', 'sessions:discover'],
      scope: { sessionIds: ['session-parent'] },
    })
    const event = {
      cursor: { hostInstanceId: 'host', sequence: 1 },
      timestamp: 1,
      payload: {
        kind: 'session-transport' as const,
        sessionId: 'session-worker',
        event: { type: 'agent_start' as const, runId: 'run-worker', timestamp: 1 },
      },
    }
    const refreshed = {
      ...caller,
      baseProfileScope: caller.profileAuthority?.scope,
      derivedSessionAuthorities: [
        {
          sessionId: 'session-worker',
          capabilities: ['sessions:discover'] as const,
          authorizationCeiling: 'ask-for-approval' as const,
        },
      ],
    }

    expect(profileAuthorityForCapabilities(refreshed, ['sessions:discover'])?.scope).toEqual({
      sessionIds: ['session-parent', 'session-worker'],
    })
    expect(profileAuthorityForCapabilities(refreshed, ['sessions:read'])?.scope).toEqual({
      sessionIds: ['session-parent'],
    })
    await expect(
      Effect.runPromise(
        authorizeLocalSessionEvent(caller, event).pipe(
          Effect.provide(eventLayer(caller, null, refreshed.derivedSessionAuthorities)),
        ),
      ),
    ).resolves.toBe(false)
  })

  it('passes only the exact target derived authority into Worker spawning', async () => {
    const caller = restrictedCaller({
      capabilities: ['sessions:spawn', 'sessions:message', 'delegations:review'],
      scope: { sessionIds: ['different-parent'] },
    })
    const refreshed = {
      ...caller,
      baseProfileScope: caller.profileAuthority?.scope,
      derivedSessionAuthorities: [
        {
          sessionId: 'session-worker',
          capabilities: ['sessions:spawn'] as const,
          authorizationCeiling: 'ask-for-approval' as const,
        },
      ],
    }
    const payload = {
      contract: 'session-lifecycle-v2' as const,
      request: {
        contractVersion: 2 as const,
        requestId: 'request-spawn',
        idempotencyKey: 'idempotency-spawn',
        command: {
          operation: 'spawn' as const,
          parentSessionId: 'session-worker',
          expectedParentRunId: 'run-worker',
          workspace: { mode: 'share-parent' as const },
          delegation: {
            objective: 'Spawn a bounded grandchild.',
            deliverables: [],
            acceptanceCriteria: [],
            dependencies: [],
            resourceReferences: [],
          },
        },
      },
    }

    await expect(
      Effect.runPromise(
        lifecycleCallerCapabilities(refreshed, payload).pipe(
          Effect.provide(eventLayer(refreshed, null, refreshed.derivedSessionAuthorities)),
        ),
      ),
    ).resolves.toEqual(['sessions:spawn'])
  })
})
