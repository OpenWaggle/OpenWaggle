import { describe, expect, it } from 'vitest'
import { retainErrorEventsOnly } from '../error-report-envelope'

const EVENT_ITEM = [{ type: 'event' }, { event_id: 'a', message: 'boom' }]

describe('retainErrorEventsOnly', () => {
  it('keeps error events and drops every other item type and the trace header', () => {
    const envelope = [
      {
        event_id: 'a',
        dsn: 'https://openwaggle@openwaggle.ai/1',
        trace: { trace_id: '0123456789abcdef0123456789abcdef', public_key: 'openwaggle' },
      },
      [
        [{ type: 'session' }, { sid: 'session-id', status: 'ok' }],
        EVENT_ITEM,
        [{ type: 'attachment', filename: 'screenshot.png' }, 'bytes'],
        [{ type: 'client_report' }, { discarded_events: [] }],
        [{ type: 'transaction' }, { spans: [] }],
        [{ type: 'replay_recording' }, 'bytes'],
        [{ type: 'log' }, { items: [] }],
      ],
    ]

    expect(retainErrorEventsOnly(envelope)).toBe(true)
    expect(envelope).toEqual([
      { event_id: 'a', dsn: 'https://openwaggle@openwaggle.ai/1' },
      [EVENT_ITEM],
    ])
  })

  it('drops the error events the caller rejects', () => {
    const scrubbed = { event_id: 'b', message: 'unknown' }
    const envelope = [{}, [EVENT_ITEM, [{ type: 'event' }, scrubbed]]]

    expect(retainErrorEventsOnly(envelope, (event) => event === scrubbed)).toBe(true)
    expect(envelope).toEqual([{}, [[{ type: 'event' }, scrubbed]]])
    expect(retainErrorEventsOnly([{}, [EVENT_ITEM]], () => false)).toBe(false)
  })

  it('reports an envelope without error events as nothing to send', () => {
    const sessionsOnly = [{}, [[{ type: 'sessions' }, { aggregates: [] }]]]
    const feedbackOnly = [{}, [[{ type: 'feedback' }, { contexts: {} }]]]

    expect(retainErrorEventsOnly(sessionsOnly)).toBe(false)
    expect(retainErrorEventsOnly(feedbackOnly)).toBe(false)
    expect(retainErrorEventsOnly('not an envelope')).toBe(false)
  })
})
