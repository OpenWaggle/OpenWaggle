import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { type LocalSessionWatchInput, watchLocalSessionEvents } from '../local-session-event-client'

const host = vi.hoisted(() => {
  const state: { frames: unknown[]; requestId: string } = { frames: [], requestId: '' }
  return {
    state,
    logged: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    reader: {
      next: async () => {
        if (state.requestId === '') throw new Error('Read before subscribing.')
        return state.frames.shift() ?? { kind: 'subscription-closed' }
      },
    },
  }
})

vi.mock('../../logger', () => ({ createLogger: () => host.logged }))
vi.mock('../local-session-client-connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../local-session-client-connection')>()),
  openLocalSessionConnection: async () => ({
    socket: { destroy: () => undefined },
    reader: host.reader,
    timeoutMs: 1_000,
  }),
  writeLocalSessionFrame: async (_socket: unknown, frame: { readonly requestId: string }) => {
    host.state.requestId = frame.requestId
    host.state.frames.unshift({
      kind: 'subscribed',
      requestId: frame.requestId,
      subscriptionId: 'subscription-1',
      cursor: cursor(1),
    })
  },
}))

const SECRET = 'my private question'
const connection: Pick<LocalSessionWatchInput, 'paths' | 'clientVersion'> = {
  paths: fromPartial({}),
  clientVersion: 'test',
}

function cursor(sequence: number) {
  return { hostInstanceId: 'host-1', sequence }
}

function event(sequence: number, payload: object) {
  return {
    kind: 'event',
    subscriptionId: 'subscription-1',
    event: { cursor: cursor(sequence), timestamp: sequence, payload },
  }
}

const assistantStart = { type: 'message_start', messageId: 'a', role: 'assistant', timestamp: 1 }
const userStart = {
  type: 'message_start',
  messageId: 'u',
  role: 'user',
  timestamp: 1,
  userMessage: { parts: [{ type: 'text', text: SECRET }], sessionNodeCreatedOrder: -1 },
}

/*
 * A subscription that failed on an event resubscribed after the same cursor, got the same event
 * again, and every Session's live events stopped. It now moves past it and keeps streaming.
 */
describe('watchLocalSessionEvents with an event it cannot decode', () => {
  it('skips past it, relays a user message start without its message, and keeps going', async () => {
    host.state.requestId = ''
    host.state.frames = [
      event(7, { kind: 'session-from-a-later-host', sessionId: 'session-1' }),
      event(8, { kind: 'session-transport', sessionId: 'session-1', event: userStart }),
      event(9, { kind: 'session-transport', sessionId: 'session-1', event: assistantStart }),
    ]
    const onCursor = vi.fn()
    const onEvent = vi.fn()

    await expect(watchLocalSessionEvents({ ...connection, onCursor, onEvent })).resolves.toEqual({
      status: 'closed',
    })

    expect(onCursor.mock.calls).toEqual([[cursor(1)], [cursor(7)]])
    const { userMessage: _dropped, ...strippedUserStart } = userStart
    expect(onEvent.mock.calls.map(([delivered]) => delivered)).toEqual([
      event(8, { kind: 'session-transport', sessionId: 'session-1', event: strippedUserStart })
        .event,
      event(9, { kind: 'session-transport', sessionId: 'session-1', event: assistantStart }).event,
    ])
    expect(host.logged.error).toHaveBeenCalledTimes(2)
    expect(host.logged.error).toHaveBeenCalledWith(expect.stringMatching(/^Skipped/), {
      kind: 'session-from-a-later-host',
      sessionId: 'session-1',
      sequence: 7,
    })
    expect(JSON.stringify(host.logged.error.mock.calls)).not.toContain(SECRET)
  })

  it('still fails on an event without a cursor, which it cannot resume after', async () => {
    host.state.requestId = ''
    host.state.frames = [{ kind: 'event', subscriptionId: 'subscription-1', event: {} }]

    await expect(watchLocalSessionEvents({ ...connection, onEvent: vi.fn() })).rejects.toThrow(
      'invalid event',
    )
  })
})
