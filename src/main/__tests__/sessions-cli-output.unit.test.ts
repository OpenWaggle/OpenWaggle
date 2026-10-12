import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalSessionClientProtocolError } from '../session-host/local-session-client-protocol-error'
import {
  classifySessionsCliError,
  validateSessionsCliOutputMode,
  writeSessionsCliError,
  writeSessionsCliResponse,
  writeSessionsCliStreamRecord,
} from '../sessions-cli-output'

describe('Sessions CLI output contract', () => {
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

    await writeSessionsCliResponse('start', result, false)
    expect(write.mock.calls.at(-1)?.[0]).toBe('Started Run\nSessionId: session-1\n')

    await writeSessionsCliResponse('start', result, true)
    const machine = String(write.mock.calls.at(-1)?.[0])
    expect(JSON.parse(machine)).toMatchObject({
      schemaVersion: 1,
      type: 'response',
      command: 'start',
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
    expect(writeSessionsCliError(new Error('Session ID is required.'), true)).toBe('usage')
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
      schemaVersion: 1,
      type: 'error',
      error: { kind: 'usage' },
    })
    expect(() => validateSessionsCliOutputMode({ json: true, jsonl: false, stream: true })).toThrow(
      'Streaming commands use --jsonl',
    )
    expect(() =>
      validateSessionsCliOutputMode({ json: false, jsonl: true, stream: false }),
    ).toThrow('Single-response commands use --json')
  })

  it('prefers typed Host protocol codes over generic messages', () => {
    expect(
      classifySessionsCliError(
        new LocalSessionClientProtocolError('capability_denied', 'An error has occurred'),
      ),
    ).toBe('authorization')
    expect(
      classifySessionsCliError(
        new LocalSessionClientProtocolError('credential_rejected', 'An error has occurred'),
      ),
    ).toBe('authentication')
  })

  it('reports a Session whose Pi file cannot be used as a conflict, whatever it says', () => {
    for (const message of [
      "This Session's Pi session file was deleted (/p/s.jsonl). Send a message to start a new transcript before forking it.",
      "This Session's Pi session file is unavailable (/p/s.jsonl): its folder is missing. Reconnect or restore it to continue the Session.",
    ]) {
      expect(
        classifySessionsCliError(
          new LocalSessionClientProtocolError('pi_session_file_unusable', message),
        ),
      ).toBe('conflict')
    }
  })

  it('maps no code to a kind by an object property name', () => {
    for (const code of ['constructor', 'tostring', '__proto__', 'hasownproperty']) {
      expect(classifySessionsCliError(new LocalSessionClientProtocolError(code, 'Failed'))).toBe(
        'internal',
      )
    }
  })
})
