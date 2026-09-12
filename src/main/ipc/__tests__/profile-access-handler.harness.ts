import * as Effect from 'effect/Effect'
import { type Mock, vi } from 'vitest'

interface ProfileAccessMocks {
  readonly commit: Mock
  readonly disconnect: Mock
  readonly dispatch: Mock
  readonly discard: Mock
  readonly refresh: Mock
  readonly remove: Mock
  readonly stage: Mock
  readonly typedHandle: Mock
  readonly ProfileCredentialCommitError: new (
    message: string,
    recoveryLocation: string,
  ) => Error & { readonly recoveryLocation: string }
}

const mocks: ProfileAccessMocks = vi.hoisted(() => ({
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

export { mocks }

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

export function resetProfileAccessMocks() {
  mocks.commit.mockReset().mockResolvedValue(undefined)
  mocks.disconnect.mockReset()
  mocks.typedHandle.mockReset()
  mocks.discard.mockReset().mockResolvedValue(undefined)
  mocks.refresh.mockReset().mockResolvedValue(undefined)
  mocks.remove.mockReset().mockResolvedValue(undefined)
  mocks.stage.mockReset().mockResolvedValue({
    credential: 'A'.repeat(43),
    metadata: { kind: 'credential-store', location: '/tmp/profile.credential' },
    recoveryLocation: '/tmp/protected-create.pending',
    recoveredPending: false,
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
}
