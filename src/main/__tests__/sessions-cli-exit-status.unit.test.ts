import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClientInput: vi.fn(),
  executeCommand: vi.fn(),
  watchEvents: vi.fn(),
}))

vi.mock('../local-session-cli-client', () => ({
  createLocalSessionCliClientInput: mocks.createClientInput,
}))

vi.mock('../session-host/local-session-client', () => ({
  executeLocalSessionCommand: mocks.executeCommand,
  watchLocalSessionEvents: mocks.watchEvents,
}))

import { decodeLocalSessionCommandResponse } from '../session-host/local-session-client-response'
import { runSessionsCli } from '../sessions-cli'

describe('Sessions CLI structured failure exit status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClientInput.mockResolvedValue({
      paths: {},
      clientKind: 'cli',
      clientVersion: 'test',
      workingDirectory: '/project',
    })
    mocks.watchEvents.mockResolvedValue({ status: 'closed' })
    vi.spyOn(process.stdout, 'write').mockImplementation((_chunk, _encoding, callback) => {
      callback?.()
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  it('returns usage without contacting the Host for an unsupported option', async () => {
    await expect(
      runSessionsCli([
        'spawn',
        'session-parent',
        '--text',
        'Review this',
        '--expected-run',
        'run-parent',
        '--workspce',
        'new-worktree',
      ]),
    ).resolves.toBe(2)

    expect(mocks.createClientInput).not.toHaveBeenCalled()
    expect(mocks.executeCommand).not.toHaveBeenCalled()
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Unknown option for OpenWaggle Sessions: --workspce'),
    )
  })

  it('rejects a typed request target mismatch before credentials or Host contact', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-cli-request-'))
    const requestPath = path.join(directory, 'request.json')
    try {
      await writeFile(
        requestPath,
        JSON.stringify({
          contract: 'session-control-v2',
          request: {
            contractVersion: 2,
            requestId: 'request-message',
            idempotencyKey: 'message-once',
            command: {
              operation: 'message',
              sessionId: 'session-payload',
              input: { text: 'Typed request', attachmentIds: [] },
            },
          },
        }),
        'utf8',
      )

      await expect(
        runSessionsCli(['message', 'session-positional', '--request-json', requestPath, '--json']),
      ).resolves.toBe(2)

      expect(mocks.createClientInput).not.toHaveBeenCalled()
      expect(mocks.executeCommand).not.toHaveBeenCalled()
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('target must be the same as the positional message target'),
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects option-only invocations instead of reporting successful help', async () => {
    await expect(runSessionsCli(['--bogus', 'ignored-value'])).resolves.toBe(2)

    expect(mocks.createClientInput).not.toHaveBeenCalled()
    expect(mocks.executeCommand).not.toHaveBeenCalled()
    expect(process.stdout.write).not.toHaveBeenCalled()
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Unsupported option-only invocation for OpenWaggle Sessions'),
    )
  })

  it('validates help options before printing usage', async () => {
    await expect(runSessionsCli(['help', '--jsoon'])).resolves.toBe(2)

    expect(mocks.createClientInput).not.toHaveBeenCalled()
    expect(mocks.executeCommand).not.toHaveBeenCalled()
    expect(process.stdout.write).not.toHaveBeenCalled()
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Unknown option for OpenWaggle Sessions: --jsoon'),
    )
  })

  it('returns not-found while preserving the structured query response', async () => {
    mocks.executeCommand.mockResolvedValue({
      contract: 'session-query-v2',
      response: {
        contractVersion: 2,
        requestId: 'request-read',
        outcome: {
          operation: 'read',
          error: { code: 'session_not_found', message: 'Session not found.' },
        },
      },
    })

    await expect(runSessionsCli(['read', 'missing-session', '--json'])).resolves.toBe(5)
    expect(JSON.parse(String(vi.mocked(process.stdout.write).mock.calls[0]?.[0]))).toMatchObject({
      type: 'response',
      result: { response: { outcome: { error: { code: 'session_not_found' } } } },
    })
  })

  it('returns conflict for a rejected mutation', async () => {
    mocks.executeCommand.mockResolvedValue({
      contract: 'session-control-v2',
      response: {
        contractVersion: 2,
        requestId: 'request-steer',
        idempotencyKey: 'steer-once',
        replayed: false,
        outcome: {
          operation: 'steer',
          effect: 'rejected',
          sessionId: 'session-1',
          code: 'run_changed',
        },
      },
    })

    await expect(
      runSessionsCli([
        'steer',
        'session-1',
        '--text',
        'Change course',
        '--expected-run',
        'run-old',
      ]),
    ).resolves.toBe(6)
  })

  it('returns authorization for a denied lifecycle command', async () => {
    mocks.executeCommand.mockResolvedValue({
      contract: 'session-lifecycle-v2',
      response: {
        contractVersion: 2,
        requestId: 'request-spawn',
        idempotencyKey: 'spawn-once',
        replayed: false,
        outcome: {
          operation: 'spawn',
          effect: 'rejected',
          code: 'capability_denied',
          retryable: false,
        },
      },
    })

    await expect(
      runSessionsCli([
        'spawn',
        'session-parent',
        '--text',
        'Review this',
        '--expected-run',
        'run-parent',
      ]),
    ).resolves.toBe(4)
  })

  it('decodes and classifies a named-profile Host rejection by its protocol code', async () => {
    mocks.executeCommand.mockImplementation(() =>
      decodeLocalSessionCommandResponse(
        {
          kind: 'error',
          requestId: 'request-list',
          code: 'capability_denied',
          message: 'An error has occurred',
        },
        'request-list',
      ),
    )

    await expect(runSessionsCli(['list', '--profile', 'reviewer', '--json'])).resolves.toBe(4)

    expect(mocks.createClientInput).toHaveBeenCalledWith({
      options: new Map([
        ['profile', ['reviewer']],
        ['json', ['true']],
      ]),
      passthrough: [],
      positionals: [],
    })
    expect(JSON.parse(String(vi.mocked(process.stderr.write).mock.calls[0]?.[0]))).toEqual({
      schemaVersion: 1,
      type: 'error',
      error: { kind: 'authorization', message: 'An error has occurred' },
    })
  })

  it('emits cursor checkpoints for initial and filtered watch progress', async () => {
    mocks.watchEvents.mockImplementationOnce(async (input) => {
      await input.onCursor({ hostInstanceId: 'host-1', sequence: 4 })
      await input.onEvent({
        cursor: { hostInstanceId: 'host-1', sequence: 5 },
        timestamp: 5,
        payload: {
          kind: 'session-state-changed',
          sessionId: 'session-other',
          stateRevision: 1,
          operation: 'message',
        },
      })
      return {
        status: 'resync-required',
        reason: 'cursor-expired',
        cursor: { hostInstanceId: 'host-1', sequence: 8 },
      }
    })

    await expect(runSessionsCli(['watch', 'session-target', '--jsonl'])).resolves.toBe(1)

    const records = vi
      .mocked(process.stdout.write)
      .mock.calls.map(([value]) => JSON.parse(String(value)).record)
    expect(records).toEqual([
      { kind: 'cursor', cursor: { hostInstanceId: 'host-1', sequence: 4 } },
      { kind: 'cursor', cursor: { hostInstanceId: 'host-1', sequence: 5 } },
      {
        status: 'resync-required',
        reason: 'cursor-expired',
        cursor: { hostInstanceId: 'host-1', sequence: 8 },
      },
    ])
  })

  it('emits export-watch cursor and resynchronization records before failing', async () => {
    mocks.watchEvents.mockImplementationOnce(async (input) => {
      await input.onCursor({ hostInstanceId: 'host-export', sequence: 2 })
      return {
        status: 'resync-required',
        reason: 'host-restarted',
        cursor: { hostInstanceId: 'host-export-new', sequence: 0 },
      }
    })

    await expect(
      runSessionsCli(['export', 'watch', 'session-1', 'export-1', '--jsonl']),
    ).resolves.toBe(1)

    const records = vi
      .mocked(process.stdout.write)
      .mock.calls.map(([value]) => JSON.parse(String(value)).record)
    expect(records).toEqual([
      { kind: 'cursor', cursor: { hostInstanceId: 'host-export', sequence: 2 } },
      {
        status: 'resync-required',
        reason: 'host-restarted',
        cursor: { hostInstanceId: 'host-export-new', sequence: 0 },
      },
    ])
  })
})
