import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { mocks, resetProfileAccessMocks } from './profile-access-handler.harness'

const { registerProfileAccessHandlers } = await import('../profile-access-handler')

describe('explicit GUI rotation after an unknown profile outcome', () => {
  beforeEach(resetProfileAccessMocks)

  it('installs the adopted pending credential after a new accepted rotation and disconnects old clients', async () => {
    const credential = 'B'.repeat(43)
    const staged = {
      credential,
      metadata: { kind: 'credential-store', location: '/tmp/profile.credential' },
      recoveryLocation: '/tmp/earlier-create.pending',
      commit: mocks.commit,
      discard: mocks.discard,
    }
    mocks.stage
      .mockResolvedValueOnce({ ...staged, recoveredPending: false })
      .mockResolvedValueOnce({ ...staged, recoveredPending: true })
    mocks.dispatch
      .mockReturnValueOnce(Effect.fail(new Error('Host response lost after creation')))
      .mockImplementationOnce((input) =>
        Effect.succeed({
          contract: 'local-access-v1',
          response: {
            contractVersion: 1,
            requestId: input.payload.request.requestId,
            idempotencyKey: input.payload.request.idempotencyKey,
            replayed: false,
            outcome: {
              operation: 'rotate',
              effect: 'profile-rotated',
              profile: {
                id: 'profile-reviewer',
                name: 'reviewer',
                capabilities: ['sessions:read'],
                scope: { all: true },
                authorizationCeiling: 'ask-for-approval',
                revokedAt: null,
                lastAuthenticatedAt: null,
                createdAt: 1,
                updatedAt: 2,
              },
            },
          },
        }),
      )
    registerProfileAccessHandlers()
    const handler = mocks.typedHandle.mock.calls[0][1]

    await Effect.runPromise(
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
    const response = await Effect.runPromise(
      handler({}, { operation: 'rotate', profileName: 'reviewer' }),
    )

    expect(response).toMatchObject({ replayed: false, outcome: { effect: 'profile-rotated' } })
    expect(mocks.stage.mock.calls[1][0]).toMatchObject({ replace: true, recoverAnyPending: true })
    expect(mocks.dispatch.mock.calls[1][0].payload.request.command).toEqual({
      operation: 'rotate',
      profileName: 'reviewer',
      credential,
    })
    expect(mocks.dispatch.mock.calls[1][0].payload.request.idempotencyKey).not.toBe(
      mocks.dispatch.mock.calls[0][0].payload.request.idempotencyKey,
    )
    expect(mocks.commit).toHaveBeenCalledOnce()
    expect(mocks.disconnect).toHaveBeenCalledExactlyOnceWith('profile-reviewer')
    expect(mocks.discard).not.toHaveBeenCalled()
  })
})
