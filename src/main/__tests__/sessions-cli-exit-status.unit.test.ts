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
  watchLocalSessionEvents: vi.fn(),
}))

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
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
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
})
