import { describe, expect, it, vi } from 'vitest'

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

import { accessCliResponseText } from '../access-cli-output'
import { CliError, cliExitCodeForKind } from '../cli-error'
import { sessionsCliResponseText } from '../sessions-cli-output'

const { runSessionsCli } = await import('../sessions-cli')

const PROFILE = {
  id: 'p-1',
  capabilities: ['sessions:read' as const],
  scope: { projectPaths: ['/repo'] },
  authorizationCeiling: 'ask-for-approval' as const,
  lastAuthenticatedAt: null,
  createdAt: 1,
  updatedAt: 1,
}

function listResponse() {
  return {
    contractVersion: 1 as const,
    requestId: 'r',
    idempotencyKey: 'k',
    replayed: false,
    outcome: {
      operation: 'list' as const,
      effect: 'profiles-listed' as const,
      profiles: [
        { ...PROFILE, name: 'active-helper', revokedAt: null },
        { ...PROFILE, id: 'p-2', name: 'old-helper', revokedAt: 5 },
      ],
    },
  }
}

describe('CLI contract output (#351)', () => {
  it('maps every kind to its documented exit code', () => {
    expect(
      (['usage', 'authentication', 'authorization', 'not_found'] as const).map(cliExitCodeForKind),
    ).toEqual([2, 3, 4, 5])
    expect(
      (['conflict', 'timeout', 'host_unavailable', 'internal'] as const).map(cliExitCodeForKind),
    ).toEqual([6, 7, 8, 1])
    expect(new CliError('conflict', 'x').kind).toBe('conflict')
  })

  it('exits with the timeout class when a bounded wait gives up, keeping the response', async () => {
    mocks.createClientInput.mockResolvedValue({ paths: {}, clientKind: 'cli', clientVersion: 't' })
    mocks.executeCommand.mockResolvedValue({
      contract: 'session-query-v2',
      response: {
        contractVersion: 2,
        requestId: 'wait',
        outcome: {
          operation: 'wait',
          timedOut: true,
          matchedSessionIds: [],
          cursor: { hostInstanceId: 'h', sequence: 1 },
          states: [],
        },
      },
    })
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((_c, _e, callback) => {
      callback?.()
      return true
    })

    await expect(
      runSessionsCli(['wait', 'session-1', '--timeout-ms', '10', '--json']),
    ).resolves.toBe(7)
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({
      type: 'response',
      result: { response: { outcome: { timedOut: true } } },
    })
    stdout.mockRestore()
  })

  it('exits with the timeout class when exports-wait gives up too', async () => {
    mocks.createClientInput.mockResolvedValue({ paths: {}, clientKind: 'cli', clientVersion: 't' })
    mocks.executeCommand.mockResolvedValue({
      contract: 'session-query-v2',
      response: {
        contractVersion: 2,
        requestId: 'exports-wait',
        outcome: { operation: 'exports-wait', timedOut: true },
      },
    })
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((_c, _e, callback) => {
      callback?.()
      return true
    })

    await expect(
      runSessionsCli(['exports-wait', 'session-1', 'operation-1', '--timeout-ms', '10', '--json']),
    ).resolves.toBe(7)
    stdout.mockRestore()
  })

  it('shows an idle Session with a queue that is not paused for what it is', () => {
    const text = sessionsCliResponseText(
      'status',
      {
        contract: 'session-query-v2',
        response: {
          outcome: {
            operation: 'status',
            sessionId: 's',
            queueState: 'running',
            activeRunId: null,
            pendingFollowUpCount: 0,
          },
        },
      },
      false,
    )

    expect(text).toContain('Follow-up Queue: not paused')
    expect(text).toContain('Active Run: none (idle)')
    expect(text).not.toContain('running')
  })

  it('wraps access output in the Hive envelope and leaves revoked profiles out by default', () => {
    const json = JSON.parse(
      accessCliResponseText({
        operation: 'list',
        response: listResponse(),
        json: true,
        includeRevoked: false,
      }),
    )
    const all = JSON.parse(
      accessCliResponseText({
        operation: 'list',
        response: listResponse(),
        json: true,
        includeRevoked: true,
      }),
    )
    const human = accessCliResponseText({
      operation: 'list',
      response: listResponse(),
      json: false,
      includeRevoked: true,
    })

    expect(json).toMatchObject({
      schemaVersion: 1,
      type: 'response',
      command: 'access profiles list',
    })
    expect(json.result.outcome.profiles.map((profile: { name: string }) => profile.name)).toEqual([
      'active-helper',
    ])
    expect(all.result.outcome.profiles).toHaveLength(2)
    expect(human).toBe(
      'active-helper\tactive\tsessions:read\tproject /repo\task-for-approval\n' +
        'old-helper\trevoked\tsessions:read\tproject /repo\task-for-approval\n',
    )
  })
})
