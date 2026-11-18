import { TERMINAL } from '@shared/constants/resource-limits'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { describe, expect, it } from 'vitest'
import {
  desktopTerminalCommandSchema,
  desktopTerminalResultSchema,
} from '../desktop-terminal-service'

const identity = { generation: 'renderer-a', sequence: 0, incarnation: 'native-record-a' }
const command = {
  service: 'terminal',
  operation: 'write',
  input: { ownerKey: 'session-a', terminalId: 'main', data: 'hello', identity },
}
const snapshot = {
  history: '',
  outputBytes: 0,
  outputGeneration: 1,
  readiness: { phase: 'spawning', generation: 1 },
  running: true,
  processName: null,
  ports: [],
  projectActionPending: false,
  inputIncarnation: identity.incarnation,
}

describe('desktop terminal incarnation boundary', () => {
  it('preserves incarnation on command, write acknowledgment, and attach snapshots', () => {
    expect(decodeUnknownExactOrThrow(desktopTerminalCommandSchema, command)).toEqual(command)
    const release = {
      service: 'terminal',
      operation: 'sendInputNow',
      input: { ownerKey: 'session-a', terminalId: 'main', incarnation: identity.incarnation },
    }
    expect(decodeUnknownExactOrThrow(desktopTerminalCommandSchema, release)).toEqual(release)
    const write = {
      service: 'terminal',
      operation: 'write',
      value: { status: 'queued', acceptedBytes: 5, identity },
    }
    expect(decodeUnknownExactOrThrow(desktopTerminalResultSchema, write)).toEqual(write)
    for (const operation of ['open', 'restart']) {
      const result = { service: 'terminal', operation, value: snapshot }
      expect(decodeUnknownExactOrThrow(desktopTerminalResultSchema, result)).toEqual(result)
    }
  })

  it.each(['', 'x'.repeat(TERMINAL.INPUT_GENERATION_MAX_LENGTH + 1), null, 1])(
    'rejects invalid incarnation %#',
    (incarnation) => {
      expect(() =>
        decodeUnknownExactOrThrow(desktopTerminalCommandSchema, {
          ...command,
          input: { ...command.input, identity: { ...identity, incarnation } },
        }),
      ).toThrow()
      expect(() =>
        decodeUnknownExactOrThrow(desktopTerminalCommandSchema, {
          service: 'terminal',
          operation: 'sendInputNow',
          input: { ownerKey: 'session-a', terminalId: 'main', incarnation },
        }),
      ).toThrow()
      expect(() =>
        decodeUnknownExactOrThrow(desktopTerminalResultSchema, {
          service: 'terminal',
          operation: 'open',
          value: { ...snapshot, inputIncarnation: incarnation },
        }),
      ).toThrow()
    },
  )
})
