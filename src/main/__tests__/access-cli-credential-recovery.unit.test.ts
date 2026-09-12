import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  ProfileCredentialCommitError,
  commitMock,
  createClientInputMock,
  discardMock,
  executeCommandMock,
  removeCredentialMock,
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
    removeCredentialMock: vi.fn(),
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
  removeStoredProfileCredential: removeCredentialMock,
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
const LIST_JSON_ARGUMENTS = ['profiles', 'list', '--json'] as const

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
    removeCredentialMock.mockReset().mockResolvedValue(undefined)
    stageCredentialMock.mockReset().mockResolvedValue({
      credential: 'generated-credential',
      recoveryLocation: '/state/credential-staging/reviewer.pending',
      recoveredPending: false,
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

  it('reports retained-credential cleanup failure after revocation without printing success', async () => {
    executeCommandMock.mockResolvedValue({
      ...PROFILE_RESPONSE,
      response: {
        ...PROFILE_RESPONSE.response,
        outcome: {
          operation: 'revoke',
          effect: 'profile-revoked',
          profile: { ...PROFILE_RESPONSE.response.outcome.profile, revokedAt: 2 },
          interruptedRuns: [],
        },
      },
    })
    removeCredentialMock.mockRejectedValue(
      Object.assign(new Error('EACCES: unlink /state/profile-credentials/retained.credential'), {
        code: 'EACCES',
      }),
    )

    await expect(runAccessCli(['profiles', 'revoke', 'reviewer', '--json'])).resolves.not.toBe(0)

    expect(process.stdout.write).not.toHaveBeenCalled()
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('/state/profile-credentials/retained.credential'),
    )
    expect(executeCommandMock).toHaveBeenCalledOnce()
    expect(discardMock).not.toHaveBeenCalled()
  })

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

    await expect(runAccessCli(CREATE_ARGUMENTS)).resolves.toBe(8)

    expect(executeCommandMock).toHaveBeenCalledTimes(2)
    expect(createClientInputMock).toHaveBeenCalledOnce()
    expect(commitMock).not.toHaveBeenCalled()
    expect(discardMock).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('--idempotency-key stable-key'))
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('/state/credential-staging/reviewer.pending'),
    )
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

  it('returns a structured authorization response with the canonical exit code', async () => {
    executeCommandMock.mockResolvedValue({
      contract: 'local-access-v1',
      response: {
        contractVersion: 1,
        requestId: 'profile-list',
        idempotencyKey: 'list-key',
        replayed: false,
        outcome: {
          operation: 'list',
          effect: 'rejected',
          code: 'missing_access_profiles',
        },
      },
    })

    await expect(runAccessCli(LIST_JSON_ARGUMENTS)).resolves.toBe(4)

    const output = vi
      .mocked(process.stdout.write)
      .mock.calls.map((call) => String(call[0]))
      .join('')
    expect(JSON.parse(output)).toMatchObject({
      contractVersion: 1,
      outcome: { effect: 'rejected', code: 'missing_access_profiles' },
    })
  })

  it('emits a structured Host-unavailable error with the canonical exit code', async () => {
    executeCommandMock.mockRejectedValue(new Error('Session Host unavailable'))

    await expect(runAccessCli(LIST_JSON_ARGUMENTS)).resolves.toBe(8)

    const output = vi
      .mocked(process.stderr.write)
      .mock.calls.map((call) => String(call[0]))
      .join('')
    expect(JSON.parse(output)).toEqual({
      schemaVersion: 1,
      type: 'error',
      error: { kind: 'host_unavailable', message: 'Session Host unavailable' },
    })
  })

  it('preserves credential recovery instructions inside a structured internal error', async () => {
    const recoveryLocation = '/tmp/protected/create.pending'
    executeCommandMock.mockResolvedValue(PROFILE_RESPONSE)
    commitMock.mockRejectedValue(
      new ProfileCredentialCommitError('credential installation failed', recoveryLocation),
    )

    await expect(runAccessCli([...CREATE_ARGUMENTS_WITHOUT_KEY, '--json'])).resolves.toBe(1)

    const output = vi
      .mocked(process.stderr.write)
      .mock.calls.map((call) => String(call[0]))
      .join('')
    expect(JSON.parse(output)).toMatchObject({
      schemaVersion: 1,
      type: 'error',
      error: {
        kind: 'internal',
        message: expect.stringContaining(
          `protected secret remains recoverable at ${recoveryLocation}`,
        ),
      },
    })
    expect(output).not.toContain('generated-credential')
  })
})
