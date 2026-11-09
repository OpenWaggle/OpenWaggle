import { afterEach, describe, expect, it, vi } from 'vitest'
import { CliError } from '../cli-error'
import {
  LocalSessionClientProtocolError,
  LocalSessionClientTimeoutError,
  LocalSessionHostUnavailableError,
} from '../session-host/local-session-client-protocol-error'
import {
  classifySessionsCliError,
  validateSessionsCliOutputMode,
  writeSessionsCliError,
  writeSessionsCliResponse,
  writeSessionsCliStreamRecord,
} from '../sessions-cli-output'

describe('Hive CLI output contract', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses human-readable output by default and schema-versioned JSON explicitly', async () => {
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((_chunk, _encoding, callback) => {
        callback?.()
        return true
      })
    const result = {
      contract: 'session-control-v2',
      response: { outcome: { operation: 'start', effect: 'started-run', sessionId: 'session-1' } },
    }

    await writeSessionsCliResponse('hive start', result, false)
    expect(write.mock.calls.at(-1)?.[0]).toBe('Started Run\nSessionId: session-1\n')

    await writeSessionsCliResponse('hive start', result, true)
    const machine = String(write.mock.calls.at(-1)?.[0])
    expect(JSON.parse(machine)).toMatchObject({
      schemaVersion: 1,
      type: 'response',
      command: 'hive start',
      result,
    })
  })

  it('emits one schema-versioned JSON object per stream record', async () => {
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((_chunk, _encoding, callback) => {
        callback?.()
        return true
      })
    await writeSessionsCliStreamRecord({ cursor: 3 }, true)
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toEqual({
      schemaVersion: 1,
      type: 'record',
      record: { cursor: 3 },
    })
  })

  it('keeps structured diagnostics on stderr and assigns stable output modes', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(writeSessionsCliError(new CliError('usage', 'Session ID is required.'), true)).toBe(
      'usage',
    )
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
      schemaVersion: 1,
      type: 'error',
      error: { kind: 'usage' },
    })
    // The kind comes from the error's type, never from words in its message (#351).
    for (const message of [
      'Session ID is required.',
      'Credential destination already exists.',
      'The Session was not found.',
      'Timed out.',
    ]) {
      expect(classifySessionsCliError(new Error(message))).toBe('internal')
    }
    expect(classifySessionsCliError(new LocalSessionClientTimeoutError('slow'))).toBe('timeout')
    expect(
      classifySessionsCliError(
        new LocalSessionClientProtocolError('authentication_throttled', 'Throttled.', {
          errorKind: 'authentication',
        }),
      ),
    ).toBe('authentication')
    expect(classifySessionsCliError(new LocalSessionHostUnavailableError('gone'))).toBe(
      'host_unavailable',
    )
    expect(() => validateSessionsCliOutputMode({ json: true, jsonl: false, stream: true })).toThrow(
      'Streaming commands use --jsonl',
    )
    expect(() =>
      validateSessionsCliOutputMode({ json: false, jsonl: true, stream: false }),
    ).toThrow('Single-response commands use --json')
  })

  it('copies the kind the Session Host gave a failure and never reads the code (ADR 0063)', () => {
    expect(
      classifySessionsCliError(
        new LocalSessionClientProtocolError('capability_denied', 'An error has occurred', {
          errorKind: 'authorization',
        }),
      ),
    ).toBe('authorization')
    // A frame without a kind, as an older Session Host sends during an upgrade, takes its code's
    // kind from the refusal table; nothing is guessed from the words in an unlisted code.
    expect(
      [
        'credential_rejected',
        'capability_denied',
        'session_not_found',
        'request_timeout',
        'x_failed',
      ].map((code) =>
        classifySessionsCliError(new LocalSessionClientProtocolError(code, 'Failed')),
      ),
    ).toEqual(['authentication', 'authorization', 'not_found', 'internal', 'internal'])
  })
})
