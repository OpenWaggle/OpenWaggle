import fs from 'node:fs'
import os from 'node:os'
import type { LocalSessionProfileManagementResponse } from '@shared/types/local-session-profile-management'
import { LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION } from '@shared/types/local-session-profile-management'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { AgentRunInterruptionService } from '../../ports/agent-run-interruption-service'
import type { LocalSessionProfileRepositoryShape } from '../../ports/local-session-profile-repository'
import { LocalSessionProfileRepository } from '../../ports/local-session-profile-repository'
import { manageLocalSessionProfiles } from '../local-session-profile-management'

const PROJECT_PATH = fs.realpathSync(os.tmpdir())

function request(
  command:
    | { readonly operation: 'list' }
    | {
        readonly operation: 'update'
        readonly profileName: string
        readonly capabilities: readonly ['sessions:read']
        readonly scope: { readonly projectPaths: readonly string[] }
        readonly authorizationCeiling: 'ask-for-approval'
      }
    | { readonly operation: 'revoke'; readonly profileName: string }
    | { readonly operation: 'rotate'; readonly profileName: string; readonly credential: string },
) {
  return {
    contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
    requestId: 'request-1',
    idempotencyKey: 'key-1',
    command,
  } as const
}

function testLayer(
  executeManagement: (
    input: Parameters<LocalSessionProfileRepositoryShape['executeManagement']>[0],
  ) => Promise<LocalSessionProfileManagementResponse>,
) {
  return Layer.mergeAll(
    Layer.succeed(LocalSessionProfileRepository, {
      list: () => Effect.succeed([]),
      findForAuthentication: () => Effect.succeed(null),
      findById: () => Effect.succeed(null),
      recordAuthentication: () => Effect.void,
      executeManagement: (input) => Effect.promise(() => executeManagement(input)),
    }),
    Layer.succeed(AgentRunInterruptionService, {
      interrupt: () => Effect.succeed({ accepted: true }),
    }),
  )
}

describe('Local Session profile management', () => {
  it('rejects delegated policy expansion and self-edit before persistence', async () => {
    const executeManagement = vi.fn()
    const caller = {
      callerId: 'profile:admin',
      profileAuthority: {
        profileId: 'admin',
        profileName: 'admin',
        capabilities: ['access:profiles'] as const,
        scope: { projectPaths: [PROJECT_PATH] },
        authorizationCeiling: 'ask-for-approval' as const,
        managementEnvelope: {
          capabilities: ['sessions:read'] as const,
          scope: { projectPaths: [PROJECT_PATH] },
          authorizationCeiling: 'ask-for-approval' as const,
        },
      },
    }
    const selfEdit = await Effect.runPromise(
      manageLocalSessionProfiles({
        caller,
        request: request({
          operation: 'update',
          profileName: 'admin',
          capabilities: ['sessions:read'],
          scope: { projectPaths: [PROJECT_PATH] },
          authorizationCeiling: 'ask-for-approval',
        }),
        now: 1,
      }).pipe(Effect.provide(testLayer(executeManagement))),
    )
    const redelegation = await Effect.runPromise(
      manageLocalSessionProfiles({
        caller,
        request: {
          ...request({ operation: 'list' }),
          command: {
            operation: 'create',
            name: 'peer-admin',
            credential: 'credential',
            capabilities: ['access:profiles'],
            scope: { projectPaths: [PROJECT_PATH] },
            authorizationCeiling: 'ask-for-approval',
          },
        },
        now: 1,
      }).pipe(Effect.provide(testLayer(executeManagement))),
    )

    expect(selfEdit.outcome).toMatchObject({ effect: 'rejected', code: 'cannot_edit_own_policy' })
    expect(redelegation.outcome).toMatchObject({
      effect: 'rejected',
      code: 'profile_redelegation_requires_local_user',
    })
    expect(executeManagement).not.toHaveBeenCalled()
  })

  it('allows an administrator to apply a bounded policy and a profile to revoke itself', async () => {
    const profile = {
      id: 'worker',
      name: 'worker',
      capabilities: ['sessions:read'] as const,
      scope: { projectPaths: [PROJECT_PATH] },
      authorizationCeiling: 'ask-for-approval' as const,
      revokedAt: null,
      lastAuthenticatedAt: null,
      createdAt: 1,
      updatedAt: 1,
    }
    const executeManagement = vi.fn(async (input) => ({
      contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
      requestId: input.request.requestId,
      idempotencyKey: input.request.idempotencyKey,
      replayed: false,
      outcome:
        input.request.command.operation === 'revoke'
          ? {
              operation: 'revoke' as const,
              effect: 'profile-revoked' as const,
              profile: { ...profile, revokedAt: 2, updatedAt: 2 },
              interruptedRuns: [],
            }
          : {
              operation: 'update' as const,
              effect: 'profile-updated' as const,
              profile,
            },
    }))
    const admin = {
      callerId: 'profile:admin',
      profileAuthority: {
        profileId: 'admin',
        profileName: 'admin',
        capabilities: ['access:profiles'] as const,
        scope: { projectPaths: [PROJECT_PATH] },
        authorizationCeiling: 'ask-for-approval' as const,
        managementEnvelope: {
          capabilities: ['sessions:read'] as const,
          scope: { projectPaths: [PROJECT_PATH] },
          authorizationCeiling: 'ask-for-approval' as const,
        },
      },
    }
    const update = await Effect.runPromise(
      manageLocalSessionProfiles({
        caller: admin,
        request: request({
          operation: 'update',
          profileName: 'worker',
          capabilities: ['sessions:read'],
          scope: { projectPaths: [PROJECT_PATH] },
          authorizationCeiling: 'ask-for-approval',
        }),
        now: 1,
      }).pipe(Effect.provide(testLayer(executeManagement))),
    )
    const selfRevoke = await Effect.runPromise(
      manageLocalSessionProfiles({
        caller: {
          ...admin,
          callerId: 'profile:worker',
          profileAuthority: {
            ...admin.profileAuthority,
            profileId: 'worker',
            profileName: 'worker',
            capabilities: [],
          },
        },
        request: request({ operation: 'revoke', profileName: 'worker' }),
        now: 2,
      }).pipe(Effect.provide(testLayer(executeManagement))),
    )

    expect(update.outcome.effect).toBe('profile-updated')
    expect(selfRevoke.outcome.effect).toBe('profile-revoked')
    expect(executeManagement).toHaveBeenCalledTimes(2)
  })

  it('prevents a named profile from taking over or revoking another profile', async () => {
    const executeManagement = vi.fn()
    const caller = {
      callerId: 'profile:bounded-admin',
      profileAuthority: {
        profileId: 'bounded-admin',
        profileName: 'bounded-admin',
        capabilities: ['access:profiles'] as const,
        scope: { projectPaths: [PROJECT_PATH] },
        authorizationCeiling: 'ask-for-approval' as const,
        managementEnvelope: {
          capabilities: ['sessions:read'] as const,
          scope: { projectPaths: [PROJECT_PATH] },
          authorizationCeiling: 'ask-for-approval' as const,
        },
      },
    }
    const layer = testLayer(executeManagement)

    const rotate = await Effect.runPromise(
      manageLocalSessionProfiles({
        caller,
        request: request({
          operation: 'rotate',
          profileName: 'higher-authority-victim',
          credential: 'attacker-known-secret',
        }),
        now: 1,
      }).pipe(Effect.provide(layer)),
    )
    const revoke = await Effect.runPromise(
      manageLocalSessionProfiles({
        caller,
        request: request({ operation: 'revoke', profileName: 'higher-authority-victim' }),
        now: 2,
      }).pipe(Effect.provide(layer)),
    )

    expect(rotate.outcome).toMatchObject({
      effect: 'rejected',
      code: 'profile_credential_control_requires_local_user',
    })
    expect(revoke.outcome).toMatchObject({
      effect: 'rejected',
      code: 'profile_credential_control_requires_local_user',
    })
    expect(executeManagement).not.toHaveBeenCalled()
  })
})
