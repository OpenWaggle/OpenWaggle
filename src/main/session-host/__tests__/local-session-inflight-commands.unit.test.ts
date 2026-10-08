import { describe, expect, it } from 'vitest'
import {
  describeLocalSessionCommand,
  LocalSessionInflightCommands,
} from '../local-session-inflight-commands'

describe('Local Session in-flight command diagnostics', () => {
  it('names a command by contract and operation without its arguments', () => {
    expect(describeLocalSessionCommand({ operation: 'status', sessionId: 'secret-id' })).toBe(
      'status',
    )
    expect(
      describeLocalSessionCommand({
        contract: 'desktop-service-v1',
        request: { operation: 'heartbeat', leaseId: 'lease' },
      }),
    ).toBe('desktop-service-v1:heartbeat')
    expect(
      describeLocalSessionCommand({
        contract: 'local-ui-v1',
        request: { requestId: 'r', command: { operation: 'pin', sessionId: 'secret-id' } },
      }),
    ).toBe('local-ui-v1:pin')
    expect(
      describeLocalSessionCommand({
        contract: 'session-control-v2',
        request: { command: { operation: 'follow-up', text: 'secret prompt' } },
      }),
    ).toBe('session-control-v2:follow-up')
    expect(
      describeLocalSessionCommand({
        contract: 'session-query-v2',
        request: { query: { operation: 'search', query: 'secret words' } },
      }),
    ).toBe('session-query-v2:search')
    expect(
      describeLocalSessionCommand({
        contract: 'host-ui-v1',
        request: { channel: 'sessions:list', args: ['secret'] },
      }),
    ).toBe('host-ui-v1:sessions:list')
    expect(describeLocalSessionCommand({ operation: 'rm -rf /' })).toBe('unknown')
    expect(
      describeLocalSessionCommand({
        contract: 'session-control-v2',
        request: { command: { operation: 'a prompt with spaces' } },
      }),
    ).toBe('session-control-v2')
    expect(describeLocalSessionCommand('payload')).toBe('unknown')
  })

  it('reports the oldest commands still executing', () => {
    let clock = 0
    const inflight = new LocalSessionInflightCommands(() => clock)
    const finishRead = inflight.track({ operation: 'read' })
    clock = 100
    inflight.track({ operation: 'search' })
    clock = 250
    inflight.track({ operation: 'status' })
    clock = 1_000
    finishRead()

    expect(inflight.describe(1, 0)).toEqual({
      inflightCommandCount: 2,
      oldestInflightCommands: [{ command: 'search', ageMs: 900 }],
    })
  })

  it('also reports the newest commands without repeating the oldest ones', () => {
    let clock = 0
    const inflight = new LocalSessionInflightCommands(() => clock)
    for (const operation of ['first', 'second', 'third', 'fourth', 'fifth']) {
      inflight.track({ operation })
      clock += 100
    }

    expect(inflight.describe(2, 2)).toEqual({
      inflightCommandCount: 5,
      oldestInflightCommands: [
        { command: 'first', ageMs: 500 },
        { command: 'second', ageMs: 400 },
      ],
      newestInflightCommands: [
        { command: 'fourth', ageMs: 200 },
        { command: 'fifth', ageMs: 100 },
      ],
    })
    expect(inflight.describe(4, 4)).toEqual({
      inflightCommandCount: 5,
      oldestInflightCommands: [
        { command: 'first', ageMs: 500 },
        { command: 'second', ageMs: 400 },
        { command: 'third', ageMs: 300 },
        { command: 'fourth', ageMs: 200 },
      ],
      newestInflightCommands: [{ command: 'fifth', ageMs: 100 }],
    })
  })
})
