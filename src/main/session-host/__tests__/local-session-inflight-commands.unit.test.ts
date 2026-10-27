import { describe, expect, it } from 'vitest'
import {
  describeLocalSessionCommand,
  isLongPollLocalSessionCommand,
  LocalSessionInflightCommands,
} from '../local-session-inflight-commands'

const DESKTOP_POLL = {
  contract: 'desktop-service-v1',
  request: { operation: 'poll', leaseId: 'l' },
}

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

  it('names long-polls and Session waits as intentionally pending', () => {
    expect(isLongPollLocalSessionCommand(DESKTOP_POLL)).toBe(true)
    for (const operation of ['wait', 'exports-wait']) {
      expect(
        isLongPollLocalSessionCommand({
          contract: 'session-query-v2',
          request: { query: { operation, timeoutMs: 30_000 } },
        }),
      ).toBe(true)
    }
    const search = (waitTimeoutMs?: number) => ({
      contract: 'session-query-v2',
      request: { query: { operation: 'search', query: 'x', waitTimeoutMs } },
    })
    expect(isLongPollLocalSessionCommand(search(5_000))).toBe(true)
    expect(isLongPollLocalSessionCommand(search(0))).toBe(false)
    expect(isLongPollLocalSessionCommand(search())).toBe(false)
    expect(
      isLongPollLocalSessionCommand({
        contract: 'desktop-service-v1',
        request: { operation: 'heartbeat', leaseId: 'l' },
      }),
    ).toBe(false)
    expect(isLongPollLocalSessionCommand({ operation: 'poll' })).toBe(false)
  })

  it('counts long-polls apart, so the oldest commands name the real work', () => {
    let clock = 0
    const inflight = new LocalSessionInflightCommands(() => clock)
    inflight.track(DESKTOP_POLL)
    clock = 100
    inflight.track({ contract: 'session-query-v2', request: { query: { operation: 'wait' } } })
    clock = 200
    inflight.track({ contract: 'host-ui-v1', request: { channel: 'sessions:get-detail' } })
    clock = 4_200

    expect(inflight.describe(8, 4)).toEqual({
      inflightCommandCount: 1,
      longPollCount: 2,
      oldestInflightCommands: [{ command: 'host-ui-v1:sessions:get-detail', ageMs: 4_000 }],
    })
  })
})
