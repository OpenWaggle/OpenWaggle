import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mocks, resetProfileAccessMocks } from './profile-access-handler.harness'

const { registerProfileAccessHandlers } = await import('../profile-access-handler')

describe('profile access IPC', () => {
  beforeEach(resetProfileAccessMocks)

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

  it('preserves a staged create credential when the Host outcome is unknown', async () => {
    mocks.dispatch.mockReturnValue(Effect.fail(new Error(`Lost response: ${'A'.repeat(43)}`)))
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
      code: 'profile_credential_outcome_unknown',
      operation: 'create',
      profileName: 'reviewer',
      idempotencyKey: mocks.stage.mock.calls[0][0].stagingKey,
      recoveryLocation: '/tmp/protected-create.pending',
      message: expect.stringContaining('unknown'),
    })
    expect(error).toHaveProperty('message', expect.not.stringContaining('A'.repeat(43)))
    expect(error).toHaveProperty('message', expect.not.stringContaining('was created'))
    expect(mocks.discard).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('retains an earlier pending credential when a fresh GUI create retry is rejected', async () => {
    mocks.stage.mockResolvedValue({
      credential: 'A'.repeat(43),
      metadata: { kind: 'credential-store', location: '/tmp/profile.credential' },
      recoveryLocation: '/tmp/earlier-operation.pending',
      recoveredPending: true,
      commit: mocks.commit,
      discard: mocks.discard,
    })
    mocks.dispatch.mockImplementation((input) =>
      Effect.succeed({
        contract: 'local-access-v1',
        response: {
          contractVersion: 1,
          requestId: input.payload.request.requestId,
          idempotencyKey: input.payload.request.idempotencyKey,
          replayed: false,
          outcome: { operation: 'create', effect: 'rejected', code: 'profile-name-exists' },
        },
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
      outcome: 'rejected',
      recoveryLocation: '/tmp/earlier-operation.pending',
      idempotencyKey: mocks.stage.mock.calls[0][0].stagingKey,
      message: expect.stringContaining('earlier request'),
    })
    expect(mocks.discard).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong contract', Effect.succeed({ contract: 'session-query-v2', response: {} })],
    [
      'undecodable response',
      Effect.succeed({ contract: 'local-access-v1', response: { secret: 'A'.repeat(43) } }),
    ],
    [
      'wrong operation',
      Effect.succeed({
        contract: 'local-access-v1',
        response: profileMutationResponse('create', 'profile-created'),
      }),
    ],
    ['transport defect', Effect.die(new Error(`Lost response: ${'A'.repeat(43)}`))],
    ['transport failure', Effect.fail(new Error(`Lost response: ${'A'.repeat(43)}`))],
  ])('preserves rotation recovery after %s without claiming creation', async (_name, dispatch) => {
    mocks.dispatch.mockReturnValue(dispatch)
    registerProfileAccessHandlers()
    const handler = mocks.typedHandle.mock.calls[0][1]

    const error = await Effect.runPromise(
      handler(
        {},
        {
          operation: 'rotate',
          profileName: 'reviewer',
        },
      ).pipe(Effect.flip),
    )

    expect(error).toMatchObject({
      code: 'profile_credential_outcome_unknown',
      operation: 'rotate',
      recoveryLocation: '/tmp/protected-create.pending',
      idempotencyKey: mocks.stage.mock.calls[0][0].stagingKey,
    })
    expect(error).toHaveProperty('message', expect.not.stringContaining('A'.repeat(43)))
    expect(error).toHaveProperty('message', expect.not.stringContaining('was created'))
    expect(error).not.toHaveProperty('cause')
    expect(mocks.discard).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('discards only a fresh credential after a definite rejection', async () => {
    const response = {
      contractVersion: 1,
      requestId: 'request',
      idempotencyKey: 'key',
      replayed: false,
      outcome: { operation: 'rotate', effect: 'rejected', code: 'profile-not-found' },
    }
    mocks.dispatch.mockReturnValue(Effect.succeed({ contract: 'local-access-v1', response }))
    registerProfileAccessHandlers()
    const handler = mocks.typedHandle.mock.calls[0][1]

    expect(
      await Effect.runPromise(handler({}, { operation: 'rotate', profileName: 'reviewer' })),
    ).toEqual(response)
    expect(mocks.discard).toHaveBeenCalledOnce()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('retains the protected credential when an in-flight IPC operation is interrupted', async () => {
    const dispatched = vi.fn()
    mocks.dispatch.mockReturnValue(Effect.sync(dispatched).pipe(Effect.andThen(Effect.never)))
    registerProfileAccessHandlers()
    const handler = mocks.typedHandle.mock.calls[0][1]
    const fiber = Effect.runFork(handler({}, { operation: 'rotate', profileName: 'reviewer' }))

    await vi.waitFor(() => expect(dispatched).toHaveBeenCalledOnce())
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(mocks.discard).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('preserves the original error for operations with no staged credential', async () => {
    const failure = new Error('Host unavailable')
    mocks.dispatch.mockReturnValue(Effect.fail(failure))
    registerProfileAccessHandlers()
    const handler = mocks.typedHandle.mock.calls[0][1]

    expect(await Effect.runPromise(handler({}, { operation: 'list' }).pipe(Effect.flip))).toBe(
      failure,
    )
    expect(mocks.stage).not.toHaveBeenCalled()
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
