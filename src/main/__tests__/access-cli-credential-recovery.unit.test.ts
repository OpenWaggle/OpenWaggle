import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  ProfileCredentialCommitError,
  commitMock,
  createClientInputMock,
  discardMock,
  executeCommandMock,
  stageCredentialMock,
} = vi.hoisted(() => {
  class ProfileCredentialCommitError extends Error {
    constructor(
      message: string,
      readonly recoveryLocation: string,
    ) {
      super(message)
    }
  }
  return {
    ProfileCredentialCommitError,
    commitMock: vi.fn(),
    createClientInputMock: vi.fn(),
    discardMock: vi.fn(),
    executeCommandMock: vi.fn(),
    stageCredentialMock: vi.fn(),
  }
})

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
  ProfileCredentialCommitError,
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
const CREATE_ARGUMENTS_WITHOUT_KEY = CREATE_ARGUMENTS.slice(0, -2)
const ROTATE_ARGUMENTS_WITHOUT_KEY = [
  'profiles',
  'rotate',
  'reviewer',
  '--credential-file',
  '/tmp/reviewer.secret',
] as const

const ROTATE_PROFILE_RESPONSE = {
  contract: 'local-access-v1',
  response: {
    ...PROFILE_RESPONSE.response,
    requestId: 'profile-rotate',
    outcome: {
      operation: 'rotate',
      effect: 'profile-rotated',
      profile: PROFILE_RESPONSE.response.outcome.profile,
    },
  },
} as const

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
    vi.spyOn(process.stdout, 'write').mockImplementation((_chunk, _encoding, callback) => {
      callback?.()
      return true
    })
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

  it('reports generated create recovery identity after an accepted credential commit failure', async () => {
    const recoveryLocation = '/tmp/protected/create.pending'
    executeCommandMock.mockResolvedValue(PROFILE_RESPONSE)
    commitMock.mockRejectedValue(
      new ProfileCredentialCommitError('credential installation failed', recoveryLocation),
    )
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(runAccessCli(CREATE_ARGUMENTS_WITHOUT_KEY)).resolves.toBe(1)

    const generatedKey = executeCommandMock.mock.calls[0]?.[0].payload.request.idempotencyKey
    const output = stderr.mock.calls.map((call) => String(call[0])).join('')
    expect(generatedKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(output).toContain('Profile "reviewer" (profile-1) was created')
    expect(output).toContain(`--idempotency-key ${String(generatedKey)}`)
    expect(output).toContain(recoveryLocation)
    expect(output).not.toContain('generated-credential')
    expect(discardMock).not.toHaveBeenCalled()
  })

  it('reports generated rotate recovery identity after an accepted credential commit failure', async () => {
    const recoveryLocation = '/tmp/protected/rotate.pending'
    executeCommandMock.mockResolvedValue(ROTATE_PROFILE_RESPONSE)
    commitMock.mockRejectedValue(
      new ProfileCredentialCommitError('credential installation failed', recoveryLocation),
    )
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(runAccessCli(ROTATE_ARGUMENTS_WITHOUT_KEY)).resolves.toBe(1)

    const generatedKey = executeCommandMock.mock.calls[0]?.[0].payload.request.idempotencyKey
    const output = stderr.mock.calls.map((call) => String(call[0])).join('')
    expect(generatedKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(output).toContain('Profile "reviewer" (profile-1) was rotated')
    expect(output).toContain(`--idempotency-key ${String(generatedKey)}`)
    expect(output).toContain(recoveryLocation)
    expect(output).not.toContain('generated-credential')
    expect(discardMock).not.toHaveBeenCalled()
  })
})
