import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { LocalSessionProfileManagementResponse } from '@shared/types/local-session-profile-management'
import { LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION } from '@shared/types/local-session-profile-management'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { AgentRunInterruptionService } from '../../ports/agent-run-interruption-service'
import type { LocalSessionProfileRepositoryShape } from '../../ports/local-session-profile-repository'
import { LocalSessionProfileRepository } from '../../ports/local-session-profile-repository'
import { manageLocalSessionProfiles } from '../local-session-profile-management'

const TEMP_ROOT = fs.realpathSync(os.tmpdir())
const ALLOWED_ROOT = fs.mkdtempSync(path.join(TEMP_ROOT, 'openwaggle-profile-allowed-'))
const DENIED_ROOT = fs.mkdtempSync(path.join(TEMP_ROOT, 'openwaggle-profile-denied-'))

afterAll(() => {
  fs.rmSync(ALLOWED_ROOT, { recursive: true, force: true })
  fs.rmSync(DENIED_ROOT, { recursive: true, force: true })
})

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

function request(workspaceRoot: string) {
  return {
    contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
    requestId: `request-${workspaceRoot}`,
    idempotencyKey: `key-${workspaceRoot}`,
    command: {
      operation: 'update' as const,
      profileName: 'worker',
      capabilities: ['sessions:read'] as const,
      scope: { workspaceRoots: [workspaceRoot] },
      authorizationCeiling: 'ask-for-approval' as const,
    },
  }
}

describe('Local Session profile workspace scope management', () => {
  it('canonicalizes bounded workspace roots and rejects workspace expansion', async () => {
    const executeManagement = vi.fn(async (input) => ({
      contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
      requestId: input.request.requestId,
      idempotencyKey: input.request.idempotencyKey,
      replayed: false,
      outcome: {
        operation: 'update' as const,
        effect: 'profile-updated' as const,
        profile: {
          id: 'worker',
          name: 'worker',
          capabilities: ['sessions:read'] as const,
          scope: input.request.command.operation === 'update' ? input.request.command.scope : {},
          authorizationCeiling: 'ask-for-approval' as const,
          revokedAt: null,
          lastAuthenticatedAt: null,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    }))
    const caller = {
      callerId: 'profile:admin',
      profileAuthority: {
        profileId: 'admin',
        profileName: 'admin',
        capabilities: ['access:profiles'] as const,
        scope: { workspaceRoots: [ALLOWED_ROOT] },
        authorizationCeiling: 'ask-for-approval' as const,
        managementEnvelope: {
          capabilities: ['sessions:read'] as const,
          scope: { workspaceRoots: [ALLOWED_ROOT] },
          authorizationCeiling: 'ask-for-approval' as const,
        },
      },
    }
    const layer = testLayer(executeManagement)
    const allowed = await Effect.runPromise(
      manageLocalSessionProfiles({ caller, request: request(ALLOWED_ROOT), now: 1 }).pipe(
        Effect.provide(layer),
      ),
    )
    const denied = await Effect.runPromise(
      manageLocalSessionProfiles({ caller, request: request(DENIED_ROOT), now: 2 }).pipe(
        Effect.provide(layer),
      ),
    )

    expect(allowed.outcome.effect).toBe('profile-updated')
    expect(executeManagement).toHaveBeenCalledTimes(1)
    expect(executeManagement.mock.calls[0]?.[0].request.command).toMatchObject({
      scope: { workspaceRoots: [fs.realpathSync(ALLOWED_ROOT)] },
    })
    expect(denied.outcome).toMatchObject({
      effect: 'rejected',
      code: 'management_envelope_exceeded',
    })
  })
})
