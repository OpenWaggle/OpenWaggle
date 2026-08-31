import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  disconnect: vi.fn(),
  dispatch: vi.fn(),
  discard: vi.fn(),
  refresh: vi.fn(),
  remove: vi.fn(),
  stage: vi.fn(),
  typedHandle: vi.fn(),
  ProfileCredentialCommitError: class ProfileCredentialCommitError extends Error {
    constructor(
      message: string,
      readonly recoveryLocation: string,
    ) {
      super(message)
    }
  },
}))

vi.mock('../../application/local-session-command-dispatcher', () => ({
  dispatchLocalSessionCommand: mocks.dispatch,
}))
vi.mock('../typed-ipc', () => ({ typedHandle: mocks.typedHandle }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/openwaggle-user-data' } }))
vi.mock('../../session-host/local-session-paths', () => ({
  resolveLocalSessionHostPaths: () => ({ stateRoot: '/tmp/openwaggle-state' }),
}))
vi.mock('../../session-host/local-session-profile-invalidation', () => ({
  disconnectLocalSessionProfile: mocks.disconnect,
  refreshLocalSessionProfileAdmissions: mocks.refresh,
}))
vi.mock('../../session-host/profile-credential', () => ({
  generateProfileCredential: vi.fn(() => 'A'.repeat(43)),
}))
vi.mock('../../session-host/profile-credential-destination', () => ({
  ProfileCredentialCommitError: mocks.ProfileCredentialCommitError,
  removeStoredProfileCredential: mocks.remove,
  stageProfileCredential: mocks.stage,
}))

import { registerProfileAccessHandlers } from '../profile-access-handler'

describe('profile access IPC', () => {
  beforeEach(() => {
    mocks.commit.mockReset().mockResolvedValue(undefined)
    mocks.disconnect.mockReset()
    mocks.typedHandle.mockReset()
    mocks.discard.mockReset().mockResolvedValue(undefined)
    mocks.refresh.mockReset().mockResolvedValue(undefined)
    mocks.remove.mockReset().mockResolvedValue(undefined)
    mocks.stage.mockReset().mockResolvedValue({
      credential: 'A'.repeat(43),
      metadata: { kind: 'credential-store', location: '/tmp/profile.credential' },
      commit: mocks.commit,
      discard: mocks.discard,
    })
    mocks.dispatch.mockReset().mockReturnValue(
      Effect.succeed({
        contract: 'local-access-v1',
        response: {
          contractVersion: 1,
          requestId: 'request-profile-list',
          idempotencyKey: 'idempotency-profile-list',
          replayed: false,
          outcome: { operation: 'list', effect: 'profiles-listed', profiles: [] },
        },
      }),
    )
  })

  it('routes profile management through the authoritative Session Host', async () => {
    registerProfileAccessHandlers()
    const handler = mocks.typedHandle.mock.calls[0][1]

    await Effect.runPromise(handler({}, { operation: 'list' }))

    expect(mocks.dispatch).toHaveBeenCalledWith({
      caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
      payload: {
        contract: 'local-access-v1',
        request: expect.objectContaining({
          contractVersion: 1,
          command: { operation: 'list' },
        }),
      },
    })
  })

  it('disconnects a rotated profile even when credential installation fails', async () => {
    const failure = new Error('credential installation failed')
    mocks.commit.mockRejectedValue(failure)
    mocks.dispatch.mockReturnValue(
      Effect.succeed({
        contract: 'local-access-v1',
        response: profileMutationResponse('rotate', 'profile-rotated'),
      }),
    )
    registerProfileAccessHandlers()
    const handler = mocks.typedHandle.mock.calls[0][1]

    const error = await Effect.runPromise(
      handler({}, { operation: 'rotate', profileName: 'reviewer' }).pipe(Effect.flip),
    )

    expect(error).toBe(failure)
    expect(mocks.disconnect).toHaveBeenCalledWith('profile-reviewer')
    expect(mocks.discard).not.toHaveBeenCalled()
  })

  it('disconnects a revoked profile even when stored-secret removal fails', async () => {
    const failure = new Error('credential removal failed')
    mocks.remove.mockRejectedValue(failure)
    mocks.dispatch.mockReturnValue(
      Effect.succeed({
        contract: 'local-access-v1',
        response: profileMutationResponse('revoke', 'profile-revoked'),
      }),
    )
    registerProfileAccessHandlers()
    const handler = mocks.typedHandle.mock.calls[0][1]

    const error = await Effect.runPromise(
      handler({}, { operation: 'revoke', profileName: 'reviewer' }).pipe(Effect.flip),
    )

    expect(error).toBe(failure)
    expect(mocks.disconnect).toHaveBeenCalledWith('profile-reviewer')
  })

  it('preserves accepted-create recovery identity when credential installation fails', async () => {
    const commitFailure = new mocks.ProfileCredentialCommitError(
      'credential installation failed',
      '/tmp/protected-create.pending',
    )
    mocks.commit.mockRejectedValue(commitFailure)
    mocks.dispatch.mockReturnValue(
      Effect.succeed({
        contract: 'local-access-v1',
        response: profileMutationResponse('create', 'profile-created'),
      }),
    )
    registerProfileAccessHandlers()
    const handler = mocks.typedHandle.mock.calls[0][1]

    const error = await Effect.runPromise(
      handler(
        {},
        {
          operation: 'create',
          name: 'reviewer',
          capabilities: ['sessions:read'],
          scope: { all: true },
          authorizationCeiling: 'ask-for-approval',
        },
      ).pipe(Effect.flip),
    )

    expect(error).toMatchObject({
      code: 'profile_credential_recovery_required',
      profileId: 'profile-reviewer',
      profileName: 'reviewer',
      idempotencyKey: 'stable-idempotency-key',
      recoveryLocation: '/tmp/protected-create.pending',
      message: expect.stringContaining('stable-idempotency-key'),
    })

    expect(mocks.discard).not.toHaveBeenCalled()
  })
})

function profileMutationResponse(
  operation: 'create' | 'rotate' | 'revoke',
  effect: 'profile-created' | 'profile-rotated' | 'profile-revoked',
) {
  return {
    contractVersion: 1,
    requestId: 'profile-request',
    idempotencyKey: 'stable-idempotency-key',
    replayed: false,
    outcome: {
      operation,
      effect,
      profile: {
        id: 'profile-reviewer',
        name: 'reviewer',
        capabilities: ['sessions:read'],
        scope: { all: true },
        authorizationCeiling: 'ask-for-approval',
        revokedAt: effect === 'profile-revoked' ? 2 : null,
        lastAuthenticatedAt: null,
        createdAt: 1,
        updatedAt: 2,
      },
      ...(effect === 'profile-revoked' ? { interruptedRuns: [] } : {}),
    },
  }
}
