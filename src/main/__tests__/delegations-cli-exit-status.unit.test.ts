import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClientInput: vi.fn(),
  executeCommand: vi.fn(),
}))

vi.mock('../local-session-cli-client', () => ({
  createLocalSessionCliClientInput: mocks.createClientInput,
}))

vi.mock('../session-host/local-session-client', () => ({
  executeLocalSessionCommand: mocks.executeCommand,
}))

import { runDelegationsCli } from '../delegations-cli'

describe('Delegations CLI structured failure exit status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClientInput.mockResolvedValue({
      paths: {},
      clientKind: 'cli',
      clientVersion: 'test',
      workingDirectory: '/project',
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  it('returns not-found while preserving a structured Delegation query error', async () => {
    mocks.executeCommand.mockResolvedValue({
      contract: 'session-query-v2',
      response: {
        contractVersion: 2,
        requestId: 'request-read',
        outcome: {
          operation: 'delegations-read',
          error: { code: 'delegation_not_found', message: 'Delegation not found.' },
        },
      },
    })

    await expect(runDelegationsCli(['read', 'missing-delegation', '--json'])).resolves.toBe(5)
    expect(JSON.parse(String(vi.mocked(process.stdout.write).mock.calls[0]?.[0]))).toMatchObject({
      response: { outcome: { error: { code: 'delegation_not_found' } } },
    })
  })

  it('returns conflict while preserving a rejected Delegation mutation', async () => {
    mocks.executeCommand.mockResolvedValue({
      contract: 'session-control-v2',
      response: {
        contractVersion: 2,
        requestId: 'request-accept',
        idempotencyKey: 'accept-once',
        replayed: false,
        outcome: {
          operation: 'delegation-accept',
          effect: 'rejected',
          sessionId: 'queen',
          code: 'submission_revision_stale',
        },
      },
    })

    await expect(
      runDelegationsCli(['accept', 'queen', 'delegation-1', '2', '--json']),
    ).resolves.toBe(6)
    expect(JSON.parse(String(vi.mocked(process.stdout.write).mock.calls[0]?.[0]))).toMatchObject({
      response: { outcome: { effect: 'rejected', code: 'submission_revision_stale' } },
    })
  })
})
