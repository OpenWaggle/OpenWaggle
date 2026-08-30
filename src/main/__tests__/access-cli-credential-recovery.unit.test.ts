import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { commitMock, createClientInputMock, discardMock, executeCommandMock, stageCredentialMock } =
  vi.hoisted(() => ({
    commitMock: vi.fn(),
    createClientInputMock: vi.fn(),
    discardMock: vi.fn(),
    executeCommandMock: vi.fn(),
    stageCredentialMock: vi.fn(),
  }))

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/openwaggle-access-test') } }))
vi.mock('../local-session-cli-client', () => ({
  createLocalSessionCliClientInput: createClientInputMock,
}))
vi.mock('../session-host/local-session-client', () => ({
  executeLocalSessionCommand: executeCommandMock,
}))
vi.mock('../session-host/profile-credential', () => ({
  generateProfileCredential: vi.fn(() => 'generated-credential'),
}))
vi.mock('../session-host/profile-credential-destination', () => ({
  removeStoredProfileCredential: vi.fn(),
  stageProfileCredential: stageCredentialMock,
}))

import { runAccessCli } from '../access-cli'

const PROFILE_RESPONSE = {
  contract: 'local-access-v1',
  response: {
    contractVersion: 1,
    requestId: 'profile-create',
    idempotencyKey: 'stable-key',
    replayed: true,
    outcome: {
      operation: 'create',
      effect: 'profile-created',
      profile: {
        id: 'profile-1',
        name: 'reviewer',
        capabilities: ['sessions:read'],
        scope: { all: true },
        authorizationCeiling: 'ask-for-approval',
        revokedAt: null,
        lastAuthenticatedAt: null,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  },
} as const

const CREATE_ARGUMENTS = [
  'profiles',
  'create',
  'reviewer',
  '--capability',
  'sessions:read',
  '--all',
  '--credential-file',
  '/tmp/reviewer.secret',
  '--idempotency-key',
  'stable-key',
] as const

describe('Access CLI credential recovery', () => {
  beforeEach(() => {
    commitMock.mockReset().mockResolvedValue(undefined)
    createClientInputMock.mockReset().mockResolvedValue({
      paths: { endpoint: '/tmp/host.sock', credentialPath: '/tmp/local.credential' },
      clientVersion: 'test',
    })
    discardMock.mockReset().mockResolvedValue(undefined)
    executeCommandMock.mockReset()
    stageCredentialMock.mockReset().mockResolvedValue({
      credential: 'generated-credential',
      metadata: { kind: 'file', path: '/tmp/reviewer.secret' },
      commit: commitMock,
      discard: discardMock,
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => vi.restoreAllMocks())

  it('replays the same operation after an ambiguous committed response', async () => {
    executeCommandMock
      .mockRejectedValueOnce(Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce(PROFILE_RESPONSE)

    await expect(runAccessCli(CREATE_ARGUMENTS)).resolves.toBe(0)

    expect(executeCommandMock).toHaveBeenCalledTimes(2)
    expect(createClientInputMock).toHaveBeenCalledOnce()
    const requests = executeCommandMock.mock.calls.map((call) => call[0].payload.request)
    expect(requests[0]).toMatchObject({
      idempotencyKey: 'stable-key',
      command: { credential: 'generated-credential' },
    })
    expect(requests[1]).toMatchObject({
      idempotencyKey: requests[0].idempotencyKey,
      command: requests[0].command,
    })
    expect(commitMock).toHaveBeenCalledOnce()
    expect(discardMock).not.toHaveBeenCalled()
  })

  it('preserves the only staged credential when reconciliation is also ambiguous', async () => {
    executeCommandMock.mockRejectedValue(new Error('Session Host unavailable'))
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(runAccessCli(CREATE_ARGUMENTS)).resolves.toBe(1)

    expect(executeCommandMock).toHaveBeenCalledTimes(2)
    expect(createClientInputMock).toHaveBeenCalledOnce()
    expect(commitMock).not.toHaveBeenCalled()
    expect(discardMock).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('--idempotency-key stable-key'))
  })
})
