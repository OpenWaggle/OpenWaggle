import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  removeStoredCopy: vi.fn(async () => undefined),
  commit: vi.fn(async () => undefined),
}))

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/openwaggle-access-test') } }))
vi.mock('../local-session-cli-client', () => ({
  createLocalSessionCliClientInput: vi.fn(async () => ({})),
}))
vi.mock('../session-host/local-session-client', () => ({
  executeLocalSessionCommand: mocks.execute,
}))
vi.mock('../session-host/profile-credential', () => ({
  generateProfileCredential: vi.fn(() => 'generated-credential'),
}))
vi.mock('../session-host/profile-credential-destination', () => ({
  ProfileCredentialCommitError: class extends Error {},
  removeStoredProfileCredential: vi.fn(async () => undefined),
  removeStoredProfileCredentialCopy: mocks.removeStoredCopy,
  stageProfileCredential: vi.fn(async () => ({
    credential: 'generated-credential',
    recoveryLocation: '/state/reviewer.pending',
    recoveredPending: false,
    metadata: { kind: 'file', location: '/tmp/reviewer.secret' },
    commit: mocks.commit,
    discard: vi.fn(async () => undefined),
  })),
}))

const { runAccessCli } = await import('../access-cli')

describe('access profiles rotate --credential-file (#351)', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation((_chunk, _encoding, callback) => {
      callback?.()
      return true
    })
  })

  it('drops the stale credential-store copy once the credential moved to a file', async () => {
    mocks.execute.mockResolvedValue({
      contract: 'local-access-v1',
      response: {
        contractVersion: 1,
        requestId: 'rotate',
        idempotencyKey: 'rotate-key',
        replayed: false,
        outcome: {
          operation: 'rotate',
          effect: 'profile-rotated',
          profile: {
            id: 'profile-1',
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
    })

    await expect(
      runAccessCli(['profiles', 'rotate', 'reviewer', '--credential-file', '/tmp/reviewer.secret']),
    ).resolves.toBe(0)

    expect(mocks.commit).toHaveBeenCalledOnce()
    expect(mocks.removeStoredCopy).toHaveBeenCalledWith({
      stateRoot: expect.any(String),
      profileName: 'reviewer',
    })
  })
})
