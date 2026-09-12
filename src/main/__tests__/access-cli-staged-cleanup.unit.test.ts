import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  execute: vi.fn(),
  stage: vi.fn(),
  discard: vi.fn(),
  commit: vi.fn(),
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/openwaggle-access-cleanup-test' } }))
vi.mock('../local-session-cli-client', () => ({ createLocalSessionCliClientInput: mocks.client }))
vi.mock('../session-host/local-session-client', () => ({
  executeLocalSessionCommand: mocks.execute,
}))
vi.mock('../session-host/profile-credential', () => ({
  generateProfileCredential: () => 'test-bearer-secret',
}))
vi.mock('../session-host/profile-credential-destination', () => ({
  ProfileCredentialCommitError: class extends Error {},
  stageProfileCredential: mocks.stage,
  removeStoredProfileCredential: vi.fn(),
}))

import { runAccessCli } from '../access-cli'
import { ProfileCredentialCleanupError } from '../session-host/profile-credential-destination-errors'

const ARGUMENTS = [
  'profiles',
  'create',
  'reviewer',
  '--capability',
  'sessions:read',
  '--all',
  '--credential-file',
  '/tmp/reviewer.secret',
  '--json',
] as const
const cleanupFailure = new ProfileCredentialCleanupError('/state/worker.pending')
const CLEANUP_MESSAGE = cleanupFailure.message
const REJECTED_RESPONSE = {
  contract: 'local-access-v1',
  response: {
    contractVersion: 1,
    requestId: 'create-reviewer',
    idempotencyKey: 'stable-key',
    replayed: false,
    outcome: { operation: 'create', effect: 'rejected', code: 'profile_already_exists' },
  },
} as const

function stderrText() {
  return vi
    .mocked(process.stderr.write)
    .mock.calls.map(([chunk]) => String(chunk))
    .join('')
}

describe('Access CLI staged credential cleanup', () => {
  beforeEach(() => {
    mocks.client.mockReset().mockResolvedValue({ paths: {}, clientVersion: 'test' })
    mocks.execute.mockReset().mockResolvedValue(REJECTED_RESPONSE)
    mocks.discard.mockReset().mockResolvedValue(undefined)
    mocks.commit.mockReset().mockResolvedValue(undefined)
    mocks.stage.mockReset().mockResolvedValue({
      credential: 'test-bearer-secret',
      recoveryLocation: '/state/worker.pending',
      recoveredPending: false,
      metadata: { kind: 'file', location: '/tmp/reviewer.secret' },
      commit: mocks.commit,
      discard: mocks.discard,
    })
    vi.spyOn(process.stdout, 'write').mockImplementation((_chunk, _encoding, callback) => {
      callback?.()
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => vi.restoreAllMocks())

  it('reports failure discarding a rejected profile credential without printing a completed response', async () => {
    mocks.discard.mockRejectedValue(cleanupFailure)

    await expect(runAccessCli(ARGUMENTS)).resolves.not.toBe(0)

    expect(process.stdout.write).not.toHaveBeenCalled()
    expect(JSON.parse(stderrText())).toMatchObject({
      type: 'error',
      error: { message: CLEANUP_MESSAGE },
    })
    expect(stderrText()).not.toContain('test-bearer-secret')
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.discard).toHaveBeenCalledOnce()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('reports cleanup failure before submission as a structured CLI error', async () => {
    mocks.client.mockRejectedValue(new Error('Cannot attach to local Host'))
    mocks.discard.mockRejectedValue(cleanupFailure)

    await expect(runAccessCli(ARGUMENTS)).resolves.not.toBe(0)

    expect(process.stdout.write).not.toHaveBeenCalled()
    expect(JSON.parse(stderrText())).toMatchObject({
      type: 'error',
      error: { message: expect.stringContaining(CLEANUP_MESSAGE) },
    })
    expect(stderrText()).toContain('Cannot attach to local Host')
    expect(stderrText()).not.toContain('test-bearer-secret')
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.discard).toHaveBeenCalledOnce()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('preserves a definitive rejection response after successful staged cleanup', async () => {
    await expect(runAccessCli(ARGUMENTS)).resolves.not.toBe(0)

    expect(mocks.discard).toHaveBeenCalledOnce()
    expect(process.stderr.write).not.toHaveBeenCalled()
    const output = vi
      .mocked(process.stdout.write)
      .mock.calls.map(([chunk]) => String(chunk))
      .join('')
    expect(JSON.parse(output)).toMatchObject(REJECTED_RESPONSE.response)
    expect(output).not.toContain('test-bearer-secret')
  })

  it.each(['preparation', 'rejection'] as const)(
    'preserves previously staged credentials on later %s failure',
    async (failure) => {
      mocks.stage.mockResolvedValue({
        credential: 'test-bearer-secret',
        metadata: { kind: 'file', location: '/tmp/reviewer.secret' },
        recoveryLocation: '/state/worker.pending',
        recoveredPending: true,
        commit: mocks.commit,
        discard: mocks.discard,
      })
      if (failure === 'preparation')
        mocks.client.mockRejectedValue(new Error('Cannot attach to local Host'))

      await expect(runAccessCli(ARGUMENTS)).resolves.not.toBe(0)

      expect(mocks.discard).not.toHaveBeenCalled()
      expect(mocks.commit).not.toHaveBeenCalled()
      expect(process.stdout.write).not.toHaveBeenCalled()
      expect(stderrText()).toContain('/state/worker.pending')
      expect(stderrText()).not.toContain('test-bearer-secret')
      if (failure === 'preparation') expect(stderrText()).toContain('Cannot attach to local Host')
    },
  )
})
