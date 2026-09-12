import fs from 'node:fs/promises'
import { LOCAL_SESSION_PROFILE_SCOPE_ENTRY_LIMIT } from '@shared/types/local-session-profile'
import { LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION } from '@shared/types/local-session-profile-management'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyProfileCredential } from '../../session-host/profile-credential'
import { manageLocalSessionProfiles } from '../local-session-profile-management'
import {
  localSessionProfileManagementTestLayer,
  PROJECT_PATH,
  profileManagementRequest,
} from './local-session-profile-management.test-support'

const BOUNDED_ADMIN = {
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

const WORKER_PROFILE = {
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

describe('Local Session profile management', () => {
  afterEach(() => vi.restoreAllMocks())

  it('rejects ineligible oversized repeated roots without filesystem work', async () => {
    const realpath = vi.spyOn(fs, 'realpath')
    const executeManagement = vi.fn()
    const paths = Array.from(
      { length: LOCAL_SESSION_PROFILE_SCOPE_ENTRY_LIMIT + 1 },
      () => '/attacker-controlled-root',
    )
    const response = await Effect.runPromise(
      manageLocalSessionProfiles({
        caller: {
          callerId: 'profile:reader',
          profileAuthority: {
            profileId: 'reader',
            profileName: 'reader',
            capabilities: ['sessions:read'],
            scope: { all: true },
            authorizationCeiling: 'ask-for-approval',
          },
        },
        request: profileManagementRequest({
          operation: 'create',
          name: 'worker',
          credential: 'A'.repeat(43),
          capabilities: ['sessions:read'],
          scope: { projectPaths: paths },
          authorizationCeiling: 'ask-for-approval',
        }),
        now: 1,
      }).pipe(Effect.provide(localSessionProfileManagementTestLayer(executeManagement))),
    )

    expect(response.outcome).toMatchObject({ effect: 'rejected', code: 'missing_access_profiles' })
    expect(realpath).not.toHaveBeenCalled()
    expect(executeManagement).not.toHaveBeenCalled()
  })

  it('isolates concurrent verifier work for distinct targets sharing an idempotency key', async () => {
    const prepared = new Map<string, string>()
    const executeManagement = vi.fn(async (input) => {
      const command = input.request.command
      if (command.operation !== 'create' || !input.preparedCredential) {
        throw new Error('Expected a prepared create command.')
      }
      prepared.set(command.name, input.preparedCredential.verifier)
      return {
        contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
        requestId: input.request.requestId,
        idempotencyKey: input.request.idempotencyKey,
        replayed: false,
        outcome: {
          operation: 'create' as const,
          effect: 'profile-created' as const,
          profile: {
            id: command.name,
            name: command.name,
            capabilities: command.capabilities,
            scope: command.scope,
            authorizationCeiling: command.authorizationCeiling,
            revokedAt: null,
            lastAuthenticatedAt: null,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      }
    })
    const run = (name: string, credential: string) =>
      Effect.runPromise(
        manageLocalSessionProfiles({
          caller: { callerId: 'local-user' },
          request: profileManagementRequest({
            operation: 'create',
            name,
            credential,
            capabilities: ['sessions:read'],
            scope: { projectPaths: [PROJECT_PATH] },
            authorizationCeiling: 'ask-for-approval',
          }),
          now: 1,
        }).pipe(Effect.provide(localSessionProfileManagementTestLayer(executeManagement))),
      )
    const credentialA = 'A'.repeat(43)
    const credentialB = 'B'.repeat(43)

    await Promise.all([run('alice', credentialA), run('bob', credentialB)])

    await expect(verifyProfileCredential(credentialA, prepared.get('alice') ?? '')).resolves.toBe(
      true,
    )
    await expect(verifyProfileCredential(credentialB, prepared.get('bob') ?? '')).resolves.toBe(
      true,
    )
    await expect(verifyProfileCredential(credentialA, prepared.get('bob') ?? '')).resolves.toBe(
      false,
    )
  })

  it('rejects delegated policy expansion and self-edit before persistence', async () => {
    const executeManagement = vi.fn()
    const layer = localSessionProfileManagementTestLayer(executeManagement)
    const selfEdit = await Effect.runPromise(
      manageLocalSessionProfiles({
        caller: BOUNDED_ADMIN,
        request: profileManagementRequest({
          operation: 'update',
          profileName: 'admin',
          capabilities: ['sessions:read'],
          scope: { projectPaths: [PROJECT_PATH] },
          authorizationCeiling: 'ask-for-approval',
        }),
        now: 1,
      }).pipe(Effect.provide(layer)),
    )
    const redelegation = await Effect.runPromise(
      manageLocalSessionProfiles({
        caller: BOUNDED_ADMIN,
        request: {
          ...profileManagementRequest({ operation: 'list' }),
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
      }).pipe(Effect.provide(layer)),
    )

    expect(selfEdit.outcome).toMatchObject({ effect: 'rejected', code: 'cannot_edit_own_policy' })
    expect(redelegation.outcome).toMatchObject({
      effect: 'rejected',
      code: 'profile_redelegation_requires_local_user',
    })
    expect(executeManagement).not.toHaveBeenCalled()
  })

  it('allows an administrator to apply a bounded policy and a profile to revoke itself', async () => {
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
              profile: { ...WORKER_PROFILE, revokedAt: 2, updatedAt: 2 },
              interruptedRuns: [],
            }
          : {
              operation: 'update' as const,
              effect: 'profile-updated' as const,
              profile: WORKER_PROFILE,
            },
    }))
    const layer = localSessionProfileManagementTestLayer(executeManagement)
    const update = await Effect.runPromise(
      manageLocalSessionProfiles({
        caller: BOUNDED_ADMIN,
        request: profileManagementRequest({
          operation: 'update',
          profileName: 'worker',
          capabilities: ['sessions:read'],
          scope: { projectPaths: [PROJECT_PATH] },
          authorizationCeiling: 'ask-for-approval',
        }),
        now: 1,
      }).pipe(Effect.provide(layer)),
    )
    const selfRevoke = await Effect.runPromise(
      manageLocalSessionProfiles({
        caller: {
          ...BOUNDED_ADMIN,
          callerId: 'profile:worker',
          profileAuthority: {
            ...BOUNDED_ADMIN.profileAuthority,
            profileId: 'worker',
            profileName: 'worker',
            capabilities: [],
          },
        },
        request: profileManagementRequest({ operation: 'revoke', profileName: 'worker' }),
        now: 2,
      }).pipe(Effect.provide(layer)),
    )

    expect(update.outcome.effect).toBe('profile-updated')
    expect(selfRevoke.outcome.effect).toBe('profile-revoked')
    expect(executeManagement).toHaveBeenCalledTimes(2)
  })

  it('prevents a named profile from taking over or revoking another profile', async () => {
    const executeManagement = vi.fn()
    const layer = localSessionProfileManagementTestLayer(executeManagement)
    const rotate = await Effect.runPromise(
      manageLocalSessionProfiles({
        caller: BOUNDED_ADMIN,
        request: profileManagementRequest({
          operation: 'rotate',
          profileName: 'higher-authority-victim',
          credential: 'attacker-known-secret',
        }),
        now: 1,
      }).pipe(Effect.provide(layer)),
    )
    const revoke = await Effect.runPromise(
      manageLocalSessionProfiles({
        caller: BOUNDED_ADMIN,
        request: profileManagementRequest({
          operation: 'revoke',
          profileName: 'higher-authority-victim',
        }),
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
