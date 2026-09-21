import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalSessionClientProtocolError } from '../session-host/local-session-client-protocol-error'

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
    vi.spyOn(process.stdout, 'write').mockImplementation((_chunk, _encoding, callback) => {
      callback?.()
      return true
    })
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
      schemaVersion: 1,
      type: 'response',
      command: 'read',
      result: { response: { outcome: { error: { code: 'delegation_not_found' } } } },
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
      schemaVersion: 1,
      type: 'response',
      command: 'accept',
      result: {
        response: { outcome: { effect: 'rejected', code: 'submission_revision_stale' } },
      },
    })
  })

  it('renders a readable summary by default', async () => {
    mocks.executeCommand.mockResolvedValue({
      contract: 'session-query-v2',
      response: {
        contractVersion: 2,
        requestId: 'request-list',
        outcome: {
          operation: 'delegations-list',
          delegations: [{ delegationId: 'delegation-1', state: 'working' }],
        },
      },
    })

    await expect(runDelegationsCli(['list', '--all'])).resolves.toBe(0)
    const output = String(vi.mocked(process.stdout.write).mock.calls[0]?.[0])
    expect(output).toContain('Delegations List')
    expect(output).toContain('delegation-1')
    expect(output).not.toMatch(/^\{"contract"/)
  })

  it.each([
    {
      name: 'credential lookup',
      error: new Error('Profile credential file could not be read.'),
      exitCode: 3,
      kind: 'authentication',
    },
    {
      name: 'profile authorization',
      error: new LocalSessionClientProtocolError('capability_denied', 'Access rejected.'),
      exitCode: 4,
      kind: 'authorization',
    },
    {
      name: 'Host timeout',
      error: new Error('Session Host timed out.'),
      exitCode: 7,
      kind: 'timeout',
    },
    {
      name: 'Host unavailability',
      error: new Error('connect ECONNREFUSED'),
      exitCode: 8,
      kind: 'host_unavailable',
    },
  ])(
    'preserves the JSON error contract for $name before a result',
    async ({ error, exitCode, kind }) => {
      if (kind === 'authentication' || kind === 'host_unavailable') {
        mocks.createClientInput.mockRejectedValue(error)
      } else {
        mocks.executeCommand.mockRejectedValue(error)
      }

      await expect(runDelegationsCli(['list', '--all', '--json'])).resolves.toBe(exitCode)
      expect(process.stdout.write).not.toHaveBeenCalled()
      expect(JSON.parse(String(vi.mocked(process.stderr.write).mock.calls[0]?.[0]))).toEqual({
        schemaVersion: 1,
        type: 'error',
        error: { kind, message: error.message },
      })
    },
  )

  it('keeps usage errors consistent with Sessions without contacting the Host', async () => {
    await expect(runDelegationsCli(['list', '--unknown', '--json'])).resolves.toBe(2)
    expect(mocks.createClientInput).not.toHaveBeenCalled()
    expect(JSON.parse(String(vi.mocked(process.stderr.write).mock.calls[0]?.[0]))).toMatchObject({
      type: 'error',
      error: { kind: 'usage', message: 'Unknown option for OpenWaggle Delegations: --unknown.' },
    })
  })
})
