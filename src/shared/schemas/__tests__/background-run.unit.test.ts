import { describe, expect, it } from 'vitest'
import { decodeUnknownExactOrThrow } from '../../schema'
import { backgroundRunActivityEventsSchema } from '../background-run'

describe('backgroundRunActivityEventsSchema', () => {
  // The snapshot copy of the activity events was a hand-written subset of the transport events: a
  // cancelled retry's `cancelled` flag was an excess property, so the exact decode lost every event.
  it('keeps a cancelled auto retry, as the transport event carries it', () => {
    const events = [
      { type: 'auto_retry_end', timestamp: 1, success: false, attempt: 2, cancelled: true },
    ]

    expect(decodeUnknownExactOrThrow(backgroundRunActivityEventsSchema, events)).toEqual(events)
  })
})
