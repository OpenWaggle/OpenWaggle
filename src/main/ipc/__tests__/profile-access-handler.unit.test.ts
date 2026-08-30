import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  typedHandle: vi.fn(),
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
  disconnectLocalSessionProfile: vi.fn(),
}))

import { registerProfileAccessHandlers } from '../profile-access-handler'

describe('profile access IPC', () => {
  beforeEach(() => {
    mocks.typedHandle.mockReset()
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
})
