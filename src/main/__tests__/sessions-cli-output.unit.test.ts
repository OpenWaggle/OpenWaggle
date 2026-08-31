import { afterEach, describe, expect, it, vi } from 'vitest'
import {
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
})
